import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../supabaseClient'

const CACHE_KEY = 'limites:cfg:v1'
let cfg = {}
let carregado = false

export async function carregarLimites(force=false) {
  if (carregado && !force) return cfg

  if (!force) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY)
      if (raw) {
        cfg = JSON.parse(raw)
        carregado = true
        console.log('[limites] cache carregado', Object.keys(cfg).length)
      }
    } catch (e) {
      console.log('[limites] erro cache', e.message)
    }
  }

  try {
    console.log('[limites] fetch remoto...')
    const { data, error } = await supabase
      .from('limites_funcionalidades')
      .select('codigo,limite_free,limite_premium_mensal,limite_premium_anual,periodo,exige_compra_unica,ativo')
      .eq('ativo', true)

    if (error) {
      console.log('[limites] erro supabase', error.message)
    } else if (Array.isArray(data)) {
      const map = {}
      data.forEach(r => { map[r.codigo] = r })
      cfg = map
      carregado = true
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cfg)).catch(()=>{})
      console.log('[limites] remoto ok', data.length)
    } else {
      console.log('[limites] retorno inesperado')
    }
  } catch (e) {
    console.log('[limites] exceção fetch', e.message)
  }

  return cfg
}

export function getLimite(codigo) {
  return cfg[codigo] || null
}

export function todosLimites() {
  return cfg
}