import { podeConsumir, registrarUsoLocal } from './usoLocal'
import { supabase } from '../supabaseClient'

export async function tentarUsar(codigo, plano) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.log('[gating]', codigo, 'bloqueado: nao_logado')
    return { ok:false, erro:'nao_logado' }
  }

  const r = await podeConsumir(codigo, plano)
  if (!r.ok) {
    console.log('[gating]', codigo, 'ERRO', r.erro, 'uso', r.uso, 'limite', r.limite)
    return r
  }

  await registrarUsoLocal(codigo)
  console.log('[gating]', codigo, 'ok +1 (plano', plano, ')')
  return { ok:true }
}