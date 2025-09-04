import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../supabaseClient'

// ================== CONFIG ==================
const PERSONAS_CACHE_KEY = 'personas:cache:v1'
const PERSONAS_MAX_AGE = 24 * 3600 * 1000
const PERSONAS_REMOTE_URL = 'https://hvnbvzqrrkqxlekbfcbg.supabase.co/storage/v1/object/datasets/personas.json'

// ================== RAW DATA LOCAL (opcional) ==================
let rawData = []
try {
  rawData = require('../../DATA/personas.json')
  console.log('[personas] local', Array.isArray(rawData) ? rawData.length : 0)
} catch {
  console.log('[personas] sem arquivo local (usará cache/remoto)')
}

// ================== HELPERS ==================
function toInt(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

// Simplificado: apenas copia chaves e garante nome/person
function normalizeKeys(obj) {
  if (!obj) return {}
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = v
  if (!out.nome && out.person) out.nome = out.person
  if (!out.person && out.nome) out.person = out.nome
  return out
}

// ================== PARSE ==================
function parseNormalArray(arr) {
  return arr.map((row, i) => {
    const o = normalizeKeys(row)
    const QI_calculado = toInt(o.QI_calculado ?? o.qi_calculado ?? o.QI ?? o.qi)
    const pIQ_HM_estimado = toInt(o.pIQ_HM_estimado ?? o.pqi_hm_estimado)
    const nome = o.nome || o.person || o.name || o.full_name
    return {
      ...o,
      index: toInt(o.index) ?? (i + 1),
      nome,
      person: nome,
      QI_calculado,
      pIQ_HM_estimado
    }
  })
}

function parseEmbeddedCsv(arr) {
  const headerString = Object.keys(arr[0])[0]
  const headers = headerString.split(';').map(h => h.trim())
  return arr.map((entry, i) => {
    const valueString = Object.values(entry)[0] ?? ''
    const values = valueString.split(';')
    const row = {}
    headers.forEach((h, idx) => (row[h] = values[idx]))
    return parseNormalArray([row])[0]
  })
}

function parseData(raw) {
  if (!Array.isArray(raw) || !raw.length) return []
  const embedded = Object.keys(raw[0] || {}).length === 1
  const arr = embedded ? parseEmbeddedCsv(raw) : parseNormalArray(raw)
  return arr.filter(p =>
    (p.nome || p.person) &&
    (p.QI_calculado != null || p.pIQ_HM_estimado != null)
  )
}

// ================== EXPORT INICIAL ==================
export let personalities = []
try {
  personalities = parseData(rawData)
} catch (e) {
  console.log('[personas] parseData inicial ERRO', e.message)
  personalities = []
}
if (!personalities.length) {
  personalities = [
    { nome: 'Albert Einstein', QI_calculado: 160 },
    { nome: 'Marie Curie', QI_calculado: 155 },
    { nome: 'Leonardo da Vinci', QI_calculado: 150 }
  ]
  console.log('[personas] usando stub (inicial)')
}

export let dataIQ = personalities.filter(p => Number.isFinite(+p.QI_calculado))
function recomputeDataIQ() {
  dataIQ = personalities.filter(p => Number.isFinite(+p.QI_calculado))
}

// ================== CACHE + REFRESH ==================
let personasLastTs = 0
let personasRefreshing = null

;(async function bootstrap() {
  // Cache
  try {
    const cached = await AsyncStorage.getItem(PERSONAS_CACHE_KEY)
    if (cached) {
      const parsedCache = JSON.parse(cached)
      // Retrocompat: antes era {ts,data}; agora {ts, personalities, dataIQ}
      const ts = parsedCache.ts
      const cachedList = parsedCache.personalities || parsedCache.data
      const cachedIQ = parsedCache.dataIQ
      if (Array.isArray(cachedList) && cachedList.length) {
        personalities = cachedList
        if (Array.isArray(cachedIQ) && cachedIQ.length) {
          dataIQ = cachedIQ
        } else {
          recomputeDataIQ()
        }
        personasLastTs = ts || 0
        const ageMin = ((Date.now() - personasLastTs) / 60000).toFixed(1)
        console.log('[personas] cache aplicado', personalities.length, 'dataIQ', dataIQ.length, 'ageMin', ageMin)
      }
    }
  } catch (e) {
    console.log('[personas] cache erro', e.message)
  }

  // Sessão + refresh
  const { data: { session } } = await supabase.auth.getSession()
  personasMaybeRefresh(session)
  supabase.auth.onAuthStateChange((_e, s) => personasMaybeRefresh(s))
})()

function personasMaybeRefresh(session) {
  const age = Date.now() - personasLastTs
  if (age < PERSONAS_MAX_AGE && personalities.length > 10) {
    console.log('[personas] skip refresh ageMin', (age / 60000).toFixed(1))
    return
  }
  if (personasRefreshing) return
  personasRefreshing = personasRefresh(session).finally(() => (personasRefreshing = null))
}

async function personasRefresh(session) {
  try {
    const headers = {}
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
      headers.apikey = supabase.supabaseKey || ''
    }
    console.log('[personas] fetch start session?', !!session)
    const res = await fetch(PERSONAS_REMOTE_URL, { headers })
    const ctype = res.headers.get('content-type')
    console.log('[personas] fetch status', res.status, 'ctype', ctype)
    if (!res.ok) return

    let buf
    try { buf = await res.arrayBuffer() } catch (e) {
      console.log('[personas] buffer erro', e.message); return
    }
    let text
    const uint = new Uint8Array(buf)
    const utf16 = [...uint.slice(0, 64)].filter((b,i)=>i%2===1 && b===0).length > 20
    try { text = new TextDecoder(utf16 ? 'utf-16le':'utf-8').decode(buf) } catch(e){ console.log('[personas] decode erro', e.message); return }
    text = text.replace(/^\uFEFF/,'').trim()
    if (text.length < 10) { console.log('[personas] corpo muito curto'); return }

    let json
    try { json = JSON.parse(text) } catch(e){ console.log('[personas] JSON.parse falhou', e.message); return }
    if (!Array.isArray(json)) { console.log('[personas] estrutura não é array'); return }

    let parsed
    try { parsed = parseData(json) } catch(e){ console.log('[personas] parseData remoto ERRO', e.message); return }

    console.log('[personas] parsed len', parsed.length)

    if (parsed.length > 10) {
      personalities = parsed
      personasLastTs = Date.now()
      recomputeDataIQ()
      AsyncStorage.setItem(
        PERSONAS_CACHE_KEY,
        JSON.stringify({ ts: personasLastTs, personalities, dataIQ })
      ).catch(()=>{})
      console.log('[personas] remoto atualizado', personalities.length, 'dataIQ', dataIQ.length)
    } else {
      console.log('[personas] parsed insuficiente')
    }
  } catch (e) {
    console.log('[personas] fetch erro', e.message)
  }
}

export async function forceRefreshPersonas() {
  personasLastTs = 0
  const { data: { session } } = await supabase.auth.getSession()
  personasMaybeRefresh(session)
}

// Info helper
export function personasInfo() {
  return {
    total: personalities.length,
    dataIQ: dataIQ.length,
    ageMin: personasLastTs ? ((Date.now() - personasLastTs)/60000).toFixed(1) : null
  }
}