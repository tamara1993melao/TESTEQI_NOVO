import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../supabaseClient'

// ===== CONFIG =====
const CACHE_KEY = 'personas:cache:v7'      // bump para invalidar versões antigas
const MIN_REFRESH_INTERVAL = 5 * 60 * 1000 // 5 min para refresh em background
const REMOTE_URL = 'https://hvnbvzqrrkqxlekbfcbg.supabase.co/storage/v1/object/datasets/personas.json'
const REQUIRE_QI = false // se true, filtra fora quem não tem nenhum QI

let mem = null
let inFlight = null
let lastFetchTs = 0

// Fallback local opcional
let localRaw = []
try {
  localRaw = require('../../DATA/personas.json')
  console.log('[personasLoader] local raw len', Array.isArray(localRaw) ? localRaw.length : 0)
} catch {
  console.log('[personasLoader] sem fallback local')
}

// ===== Helpers =====
function toIntLike(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  // remove símbolos aproximados e texto
  const cleaned = s.replace(/[^\d\-]/g, '')
  if (!cleaned) return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

function normalizeKeys(o) {
  if (!o) return {}
  const out = { ...o }
  // preferir person
  if (!out.person && out.nome) out.person = out.nome
  if (!out.nome && out.person) out.nome = out.person // retrocompat áreas antigas
  return out
}

// Embedded CSV: quando cada objeto tem só 1 chave (header)
function looksEmbedded(arr) {
  return Array.isArray(arr) && arr.length && Object.keys(arr[0]).length === 1
}

function parseEmbeddedCsv(arr) {
  const headerLine = Object.keys(arr[0])[0]
  const headers = headerLine.split(/;|,/).map(h => h.trim())
  return arr.map((row, i) => {
    const valueLine = Object.values(row)[0] ?? ''
    const values = valueLine.split(/;|,/)
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = values[idx] })
    return obj
  })
}

// Decodifica ArrayBuffer com heurística UTF-16/UTF-8 + remove BOM
function decodeBuffer(buf) {
  if (!buf) return ''
  const uint = new Uint8Array(buf)
  // heurística simples de UTF-16 LE: muitos zeros em bytes ímpares
  const zeros = [...uint.slice(0, 80)].filter((b, i) => i % 2 === 1 && b === 0).length
  const utf16 = zeros > 20
  let text
  try {
    text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(buf)
  } catch {
    text = new TextDecoder('utf-8').decode(buf)
  }
  return text.replace(/^\uFEFF/, '').trim()
}

function normalizeAndParse(rawArr = []) {
  if (!Array.isArray(rawArr)) return { all: [], dataIQAny: [], dataIQBoth: [], stats: {} }

  // Se for embedded CSV, converter primeiro
  let base = rawArr
  if (looksEmbedded(rawArr)) {
    try {
      base = parseEmbeddedCsv(rawArr)
      console.log('[personasLoader] embedded CSV detectado -> expandido', base.length)
    } catch (e) {
      console.log('[personasLoader] erro parse embedded', e.message)
    }
  }

  const all = []
  let total = 0, semNome = 0
  for (let i = 0; i < base.length; i++) {
    total++
    const raw = normalizeKeys(base[i])
    const name = raw.person || raw.nome || raw.Person || raw.Nome
    if (!name) {
      semNome++
      continue
    }

    const QI_calculado = toIntLike(raw.QI_calculado ?? raw.qi_calculado ?? raw.QI ?? raw.qi)
    const pIQ_HM_estimado = toIntLike(raw.pIQ_HM_estimado ?? raw.qi_estimado ?? raw.QI_estimado ?? raw.pqi_hm_estimado)

    // Monta objeto final
    const obj = {
      ...raw,
      person: String(name).trim(),
      nome: undefined, // evitar uso futuro; se quiser manter: nome: String(name).trim(),
      QI_calculado,
      pIQ_HM_estimado,
      index: toIntLike(raw.index) ?? (i + 1)
    }

    // Filtragem condicional
    if (REQUIRE_QI && (QI_calculado == null && pIQ_HM_estimado == null)) continue

    all.push(obj)
  }

  const dataIQAny = all.filter(p => p.QI_calculado != null || p.pIQ_HM_estimado != null)
  const dataIQBoth = all.filter(p => p.QI_calculado != null && p.pIQ_HM_estimado != null)

  console.log('[personasLoader] parsed',
    'rawTotal=', total,
    'semNome=', semNome,
    'mantidos=', all.length,
    'QI_any=', dataIQAny.length,
    'QI_both=', dataIQBoth.length,
    'requireQI=', REQUIRE_QI
  )

  return {
    all,
    dataIQAny,
    dataIQBoth,
    stats: {
      rawTotal: total,
      semNome,
      mantidos: all.length,
      qiAny: dataIQAny.length,
      qiBoth: dataIQBoth.length
    }
  }
}

// ===== Public Stats =====
export function personasStats() {
  if (!mem) return { total: 0, qiAny: 0, qiBoth: 0, ageMin: null }
  return {
    total: mem.all.length,
    qiAny: mem.dataIQAny.length,
    qiBoth: mem.dataIQBoth.length,
    ageMin: ((Date.now() - lastFetchTs) / 60000).toFixed(1)
  }
}

// ===== Loading =====
export async function loadPersonalities() {
  if (mem) {
    if (Date.now() - lastFetchTs > MIN_REFRESH_INTERVAL) safeRefresh()
    return mem
  }

  // Cache
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.mem?.all?.length) {
        mem = parsed.mem
        lastFetchTs = parsed.ts || 0
        console.log('[personasLoader] cache aplicado', mem.all.length, 'qiBoth', mem.dataIQBoth.length)
        if (Date.now() - lastFetchTs > MIN_REFRESH_INTERVAL) safeRefresh()
        return mem
      }
    }
  } catch (e) {
    console.log('[personasLoader] cache read erro', e.message)
  }

  await safeRefresh()
  if (mem) return mem

  // Fallback local
  const parsedLocal = normalizeAndParse(localRaw)
  mem = parsedLocal
  lastFetchTs = Date.now()
  console.log('[personasLoader] usando fallback local', mem.all.length)
  return mem
}

function safeRefresh() {
  if (inFlight) return inFlight
  inFlight = refreshRemote()
    .catch(() => {})
    .finally(() => { inFlight = null })
  return inFlight
}

async function refreshRemote() {
  try {
    if (Date.now() - lastFetchTs < MIN_REFRESH_INTERVAL && mem) return

    // Tentar público sem sessão primeiro
    const headers = {}
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
      headers.apikey = supabase.supabaseKey || ''
    }

    const res = await fetch(`${REMOTE_URL}?v=${Date.now()}`, { headers })
    console.log('[personasLoader] fetch status', res.status)
    if (!res.ok) return

    // Lê como ArrayBuffer para lidar com UTF-16 se ocorrer
    const buf = await res.arrayBuffer()
    const text = decodeBuffer(buf)
    if (text.length < 20) { console.log('[personasLoader] texto muito curto'); return }

    let json
    try { json = JSON.parse(text) } catch (e) {
      console.log('[personasLoader] JSON parse erro', e.message)
      return
    }
    if (!Array.isArray(json)) { console.log('[personasLoader] formato não-array'); return }

    const parsed = normalizeAndParse(json)
    if (!parsed.all.length) { console.log('[personasLoader] vazio após parse'); return }

    mem = parsed
    lastFetchTs = Date.now()
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ts: lastFetchTs, mem }))
    console.log('[personasLoader] remoto atualizado', mem.all.length, 'qiBoth', mem.dataIQBoth.length)
  } catch (e) {
    console.log('[personasLoader] refreshRemote erro', e.message)
  }
}

export function clearPersonasCache() {
  mem = null
  lastFetchTs = 0
  AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
  console.log('[personasLoader] cache limpo')
}

export async function forceRefreshPersonas() {
  lastFetchTs = 0
  await safeRefresh()
}

export function getAllPersonalities() {
  return mem?.all || []
}