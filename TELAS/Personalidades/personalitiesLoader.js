import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../supabaseClient'
import { processRaw } from './dataProcessor'

let mem = null
let inFlight = null
let lastFetchTs = 0
const CACHE_KEY = 'personas:cache:v4' // antes: v3
const MAX_AGE = 24*3600*1000
const MIN_REFRESH_INTERVAL = 5 * 60 * 1000 // não refaz download em menos de 5 min

export async function loadPersonalities() {
  if (mem) {
    // Dispara refresh em background só se passou intervalo
    if (Date.now() - lastFetchTs > MIN_REFRESH_INTERVAL) safeRefresh()
    return mem
  }

  // Cache persistido
  try {
    const c = await AsyncStorage.getItem(CACHE_KEY)
    if (c) {
      const { ts, data } = JSON.parse(c)
      if (Array.isArray(data)) {
        mem = data
        if (Date.now() - ts > MIN_REFRESH_INTERVAL) safeRefresh()
        return mem
      }
    }
  } catch {}

  // Primeiro carregamento remoto (com lock)
  await safeRefresh()
  if (mem) return mem

  // Fallback
  mem = processRaw(localRaw)
  return mem
}

function safeRefresh() {
  if (inFlight) return inFlight
  inFlight = refreshRemote()
    .catch(()=>{})
    .finally(()=> { inFlight = null })
  return inFlight
}

async function refreshRemote() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { console.log('[personas] sem sessão'); return }

    if (Date.now() - lastFetchTs < MIN_REFRESH_INTERVAL && mem) return

    const url = 'https://hvnbvzqrrkqxlekbfcbg.supabase.co/storage/v1/object/datasets/personas.json'
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabase.supabaseKey || '' // algumas libs exigem
      }
    })
    console.log('[personas] fetch status', res.status)
    if (!res.ok) { return }

    const text = await res.text()
    console.log('[personas] texto len', text.length)

    let json
    try { json = JSON.parse(text) }
    catch(e) { console.log('[personas] JSON parse erro', e.message); return }

    let parsed
    try { parsed = processRaw(json) }
    catch(e) { console.log('[personas] processRaw erro', e.message); return }

    console.log('[personas] parsed count', Array.isArray(parsed) ? parsed.length : 'nao-array')

    if (Array.isArray(parsed) && parsed.length) {
      mem = parsed
      lastFetchTs = Date.now()
      AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ts: lastFetchTs, data: parsed })
      ).catch(()=>{})
    } else if (!mem) {
      console.log('[personas] remoto vazio, fallback local')
      mem = processRaw(localRaw)
    }
  } catch(e) {
    console.log('[personas] refreshRemote exceção', e.message)
    if (!mem) mem = processRaw(localRaw)
  }
}

export function clearPersonasCache() {
  mem = null
  lastFetchTs = 0
  AsyncStorage.removeItem(CACHE_KEY).catch(()=>{})
}