import AsyncStorage from '@react-native-async-storage/async-storage'
import { carregarLimites, getLimite } from './limitesConfig'
import { supabase } from '../supabaseClient'

// chave por dia
function chaveUsoDia() {
  const d = new Date().toISOString().slice(0,10) // YYYY-MM-DD
  return 'uso:dia:' + d
}

let cacheUso = null

async function loadUso() {
  if (cacheUso) return cacheUso
  const key = chaveUsoDia()
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw) {
      cacheUso = JSON.parse(raw)
    } else {
      cacheUso = {}
    }
  } catch {
    cacheUso = {}
  }
  return cacheUso
}

async function saveUso() {
  const key = chaveUsoDia()
  try { await AsyncStorage.setItem(key, JSON.stringify(cacheUso)) } catch {}
}

export async function podeConsumir(codigo, plano='free') {
  await carregarLimites()
  await loadUso()

  const limiteRow = getLimite(codigo)
  if (!limiteRow) {
    return { ok:false, erro:'codigo_desconhecido' }
  }

  // Compra única (STF_ACCESS): verificar no Supabase se o usuário tem entitlement ativo
  if (limiteRow.exige_compra_unica) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok:false, erro:'nao_logado' }
    const { data, error } = await supabase
      .from('compras')
      .select('is_active, product_id, expires_at')
      .eq('user_id', user.id)
      .eq('product_id', 'com.sigmaiq.stf')
      .limit(1)
      .maybeSingle()
    if (!error && data && data.is_active && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now())) {
      // liberado por compra/entitlement
    } else {
      return { ok:false, erro:'compra_unica_necessaria' }
    }
  }

  const usado = cacheUso[codigo] || 0
  let limite = 0
  if (plano === 'premium_mensal') limite = limiteRow.limite_premium_mensal
  else if (plano === 'premium_anual') limite = limiteRow.limite_premium_anual
  else limite = limiteRow.limite_free

  // periodo total (não reseta) – só STF, que já bloqueamos acima
  if (limiteRow.periodo === 'total') {
    // se grátis e exige compra única, já retornou
    return { ok:true, uso:usado, limite } // sem incremento aqui
  }

  if (usado >= limite) {
    return { ok:false, erro:'limite', uso:usado, limite }
  }

  return { ok:true, uso:usado, limite }
}

export async function registrarUsoLocal(codigo) {
  await loadUso()
  cacheUso[codigo] = (cacheUso[codigo] || 0) + 1
  await saveUso()
}