import { supabase } from '../../supabaseClient';

export async function obterDesafioAtivo() {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('challenges')
    .select('id,question,deadline,answer_instructions,active')
    .eq('active', true)
    .gte('deadline', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.log('obterDesafioAtivo', error.message);
  return data;
}

export async function listarDesafios(limit = 50) {
  const { data, error } = await supabase
    .from('challenges')
    .select('id,question,deadline,active,created_at')
    .order('active', { ascending: false })               // ativos primeiro (true > false)
    .order('deadline', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.log('listarDesafios', error.message); return []; }
  return data || [];
}

export async function enviarRespostaDesafio(challengeId, resposta) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Usuário não autenticado');
  const { data, error } = await supabase
    .from('challenge_submissions')
    .insert({ challenge_id: challengeId, user_id: uid, answer_raw: resposta })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function obterEstatisticasDesafio() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('challenge_user_stats')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) console.log('obterEstatisticasDesafio', error.message);
  return data;
}