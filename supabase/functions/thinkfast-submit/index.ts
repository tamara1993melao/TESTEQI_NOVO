/// <reference lib="deno.ns" />
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST')
    return json({ error:'POST only' }, 405);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ error:'invalid json' }, 400);
  }
  console.log('[submit] raw body', body);

  const {
    user_id,
    score: rawScore,
    stats: rawStats,
    mode,
    success,
    duration_ms,
    user_name: clientName
  } = body || {};

  const score = num(rawScore);

  const hits       = rawStats?.hits != null ? num(rawStats.hits) : null;
  const misses     = rawStats?.misses != null ? num(rawStats.misses) : null;
  const penalties  = rawStats?.penalties != null ? num(rawStats.penalties) : null;
  const accuracy   = rawStats?.accuracy != null ? num(rawStats.accuracy) : null;
  const avg        = rawStats?.avg != null ? num(rawStats.avg) : null;
  const best       = rawStats?.best != null ? num(rawStats.best) : null;
  const med        = rawStats?.med != null ? num(rawStats.med) : null;
  const sd         = rawStats?.sd != null ? num(rawStats.sd) : null;

  const validationErrors: string[] = [];
  if (!user_id) validationErrors.push('user_id missing');
  if (score === null) validationErrors.push('score invalid');
  if (hits === null) validationErrors.push('stats.hits invalid');
  if (misses === null) validationErrors.push('stats.misses invalid');
  if (penalties === null) validationErrors.push('stats.penalties invalid');

  if (validationErrors.length) {
    console.log('[submit] validation failed', validationErrors);
    return json({ error:'validation_failed', details: validationErrors }, 422);
  }

  // Obter nome (nickname > name > username) se não veio
  let user_name = clientName || null;
  if (!user_name) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('nickname,name,username')
      .eq('id', user_id)
      .maybeSingle();
    user_name = prof?.nickname || prof?.name || prof?.username || 'Jogador';
  }

  const day = new Date().toISOString().slice(0,10);

  const insertPayload = {
    user_id,
    user_name,
    day,
    score,
    success: !!success,
    duration_ms: num(duration_ms),
    stats: {
      hits, misses, penalties,
      accuracy, avg, best, med, sd
    },
    mode: mode || 'daily'
  };

  try {
    // Upsert (caso a PK seja (day,user_id)); ajuste se mudou schema.
    const { data: inserted, error: upErr } = await supabase
      .from('thinkfast_daily_attempts')
      .upsert(insertPayload, { onConflict: 'day,user_id' })
      .select()
      .maybeSingle();

    if (upErr) {
      console.log('[submit] upsert error', upErr.message);
      return json({ error:'db_upsert_failed', details: upErr.message }, 500);
    }
    console.log('[submit] upsert ok', { attempt_id: inserted?.id, score, user_name });

    // Leaderboard (Top 5 do dia)
    const { data: lb, error: lbErr } = await supabase
      .from('thinkfast_daily_leaderboard')
      .select('user_id,user_name,score,rank,accuracy')
      .eq('day', day)
      .order('rank', { ascending:true })
      .limit(5);

    if (lbErr) console.log('[submit] leaderboard error', lbErr.message);

    const myRank = lb?.find(r=>r.user_id === user_id)?.rank ?? null;

    return json({
      ok: true,
      attempt_id: inserted?.id,
      myRank,
      leaderboard: lb || []
    }, 200, true);
  } catch (e) {
    console.log('[submit] unexpected error', (e as Error).message);
    return json({ error:'unexpected', details:(e as Error).message }, 500);
  }
});

function json(data: unknown, status=200, noStore=false) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'Content-Type':'application/json',
      'Cache-Control': noStore ? 'no-store' : 'max-age=0'
    }
  });
}