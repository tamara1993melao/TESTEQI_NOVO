/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Expo } from "https://esm.sh/expo-server-sdk@3.7.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MIN_RANK_DROP_DIFF = Number(Deno.env.get("MIN_RANK_DROP_DIFF") || 1);
const RANK_DROP_SUPPRESS_HOURS = Number(Deno.env.get("RANK_DROP_SUPPRESS_HOURS") || 6);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const expo = new Expo();

// AUTORIZAÇÃO DESABILITADA (tudo passa) – reaja se quiser depois
function authorized(_req: Request) { return true; }

// Enfileira lote rank_drop dentro do schema existente
async function enqueueRankDrops(game: string, segment: string, drops: any[]) {
  if (!drops.length) return { inserted: 0, skipped: 0 };
  // Supressão: evita duplicar mesma queda dentro da janela
  const cutoffIso = new Date(Date.now() - RANK_DROP_SUPPRESS_HOURS * 3600_000).toISOString();
  const eventKeys = drops.map(d => `rank_drop:${d.user_id}:${game}:${segment}`);
  // Busca existentes recentes (pendentes / enviadas recentemente)
  const { data: existing } = await supabase
    .from("notification_queue")
    .select("event_key, created_at, status")
    .in("event_key", eventKeys)
    .gte("created_at", cutoffIso);

  const existingSet = new Set((existing || []).map(e => e.event_key));
  const rows = [];
  for (const d of drops) {
    if (typeof d.old_rank !== "number" || typeof d.new_rank !== "number") continue;
    const diff = d.new_rank - d.old_rank;
    if (diff <= 0 || diff < MIN_RANK_DROP_DIFF) continue;
    const event_key = `rank_drop:${d.user_id}:${game}:${segment}`;
    if (existingSet.has(event_key)) continue;
    rows.push({
      title: "Você caiu no ranking",
      body: `Jogo ${game}${segment && segment !== "_" ? " ("+segment+")" : ""}: ${d.old_rank} → ${d.new_rank}`,
      data: {
        t: "rank_drop",
        game,
        segment,
        old_rank: d.old_rank,
        new_rank: d.new_rank,
        diff
      },
      user_id: d.user_id,
      status: "pending",
      scheduled_at: new Date().toISOString(),
      event_key
    });
  }
  if (!rows.length) return { inserted: 0, skipped: drops.length };
  // Insert ignorando conflitos na unique (event_key)
  const { error } = await supabase
    .from("notification_queue")
    .insert(rows, { onConflict: "event_key" });
  if (error) {
    console.log("[enqueue:error]", error.message);
    return { inserted: 0, skipped: drops.length };
  }
  console.log("[enqueue:rank_drop]", rows.length);
  return { inserted: rows.length, skipped: drops.length - rows.length };
}

// Adicione util para obter rule de hoje (modo)
async function getTodayThinkFastRule(){
  const today = new Date().toISOString().slice(0,10);
  const { data } = await supabase
    .from('thinkfast_daily_config')
    .select('mode,config,day')
    .eq('day', today)
    .maybeSingle();
  return data || null;
}

// (ALTERAR) processQueue: suportar broadcast (user_id null)
async function processQueue() {
  const { data: pending, error: listErr } = await supabase
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (listErr) {
    console.log("[process:list:error]", listErr.message);
    return { processed: 0 };
  }
  if (!pending?.length) return { processed: 0 };

  const ids = pending.map(j => j.id);
  const { error: updErr } = await supabase
    .from("notification_queue")
    .update({ status: "sending" })
    .in("id", ids);
  if (updErr) {
    console.log("[process:claim:error]", updErr.message);
    return { processed: 0 };
  }

  let sent = 0;
  for (const job of pending) {
    try {
      let tokens: string[] = [];
      if (job.user_id) {
        // Individual
        const { data: devices, error: devErr } = await supabase
          .from("user_devices")
            .select("expo_push_token")
            .eq("user_id", job.user_id);
        if (devErr) { console.log("[push:devices:error]", devErr.message); continue; }
        tokens = (devices||[]).map(d=>d.expo_push_token);
      } else {
        // Broadcast (ThinkFast diário ou outros)
        const { data: devices, error: devErr } = await supabase
          .from("user_devices")
          .select("expo_push_token,allow_thinkfast_daily")
          .eq("allow_thinkfast_daily", true);
        if (devErr) { console.log("[push:broadcast:devices:error]", devErr.message); continue; }
        tokens = (devices||[]).map(d=>d.expo_push_token);
      }

      tokens = tokens.filter(t => Expo.isExpoPushToken(t));
      if (!tokens.length) continue;

      const messages = tokens.map(t => ({
        to: t,
        sound: "default",
        title: job.title,
        body: job.body,
        data: job.data
      }));

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try { await expo.sendPushNotificationsAsync(chunk); }
        catch(e:any) { console.log("[push:chunk:error]", e.message); }
      }
      sent++;
    } catch(e:any) {
      console.log("[push:error]", e.message);
    }
  }

  await supabase
    .from("notification_queue")
    .update({ status: "sent" })
    .in("id", ids);

  console.log("[process:done]", sent, "/", pending.length);
  return { processed: pending.length, sent };
}

Deno.serve(async (req) => {
  if (!authorized(req)) return new Response("forbidden", { status: 403 });

  // GET sempre processa fila
  if (req.method === "GET") {
    const res = await processQueue();
    return new Response(JSON.stringify({ ok: true, mode: "process:get", ...res }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (req.method !== "POST") {
    return new Response("method-not-allowed", { status: 405 });
  }

  // Lê texto bruto
  let raw = "";
  try { raw = await req.text(); } catch {}
  console.log("[req:raw:first120]", raw.slice(0,120));

  // POST vazio -> processa
  if (raw.trim() === "") {
    const res = await processQueue();
    return new Response(JSON.stringify({ ok: true, mode: "process:empty", ...res }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Primeira tentativa de parse
  let payload: any = {};
  try { payload = JSON.parse(raw); }
  catch (e:any) {
    console.log("[req:parse:error:1]", e.message);
    // Tenta converter aspas simples
    const alt = raw.replace(/'/g,'"');
    if (alt !== raw) {
      try { payload = JSON.parse(alt); console.log("[req:parse:recovered:singleQuotes]"); }
      catch(e2:any){ console.log("[req:parse:error:2]", e2.message); }
    }
  }

  // Se veio embrulhado: { body: "{...json...}" }
  if (payload && typeof payload.body === "string" && !payload.type && !payload.game) {
    try {
      const inner = JSON.parse(payload.body);
      console.log("[req:inner:parsed:keys]", Object.keys(inner));
      payload = inner;
    } catch(e:any) {
      console.log("[req:inner:parse:error]", e.message);
    }
  }

  // Se drops veio como string
  if (payload && typeof payload.drops === "string") {
    try {
      payload.drops = JSON.parse(payload.drops);
      console.log("[req:drops:string->array]");
    } catch {}
  }

  // Fallbacks
  if (!payload.type && payload.game && Array.isArray(payload.drops)) {
    payload.type = "rank_drop_batch";
  }
  if (!payload.type && !payload.game) {
    // Assumir process_queue para qualquer coisa desconhecida
    payload.type = "process_queue";
  }

  console.log("[req:final:type]", payload.type, "keys:", Object.keys(payload));

  if (payload.type === "rank_drop_batch") {
    const game = payload.game;
    const segment = payload.segment ?? "_";
    const drops = Array.isArray(payload.drops) ? payload.drops : [];
    if (!game || !drops.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: "bad-payload",
        debug: { game, dropsType: typeof payload.drops, dropsLen: drops.length }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const res = await enqueueRankDrops(game, segment, drops);
    return new Response(JSON.stringify({ ok: true, mode: "enqueue", ...res }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (payload.type === "process_queue") {
    const res = await processQueue();
    return new Response(JSON.stringify({ ok: true, mode: "process", ...res }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (payload.type === "thinkfast_daily_enqueue") {
    const today = new Date().toISOString().slice(0,10);
    const event_key = `thinkfast_daily:${today}`;

    // Já existe?
    const { data: exists } = await supabase
      .from('notification_queue')
      .select('id')
      .eq('event_key', event_key)
      .maybeSingle();
    if (exists) {
      return new Response(JSON.stringify({ ok:true, mode:'enqueue:exists' }), {
        headers:{ 'Content-Type':'application/json' }
      });
    }

    const rule = await getTodayThinkFastRule();
    let modeText = '';
    if (rule?.mode === 'max_targets_time') modeText = 'Estoure o máximo!';
    else if (rule?.mode === 'click_only') modeText = 'Clique só nas cores permitidas!';
    else if (rule?.mode === 'avoid_colors') modeText = 'Evite as cores proibidas!';

    const { error: insErr } = await supabase
      .from('notification_queue')
      .insert({
        title: 'Desafio ThinkFast de hoje',
        body: modeText || 'Novo desafio disponível. Jogue agora!',
        data: { t:'thinkfast_daily', day: today, mode: rule?.mode || null },
        user_id: null,              // broadcast
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        event_key
      });
    if (insErr) {
      return new Response(JSON.stringify({ ok:false, error: insErr.message }), {
        status:500, headers:{ 'Content-Type':'application/json' }
      });
    }
    // Opcional: já processar imediatamente
    const res = await processQueue();
    return new Response(JSON.stringify({ ok:true, mode:'enqueue:thinkfast_daily', processed: res.processed, sent: res.sent }), {
      headers:{ 'Content-Type':'application/json' }
    });
  }

  // Último fallback nunca deve bater agora
  const res = await processQueue();
  return new Response(JSON.stringify({ ok: true, mode: "process:fallback", ...res }), {
    headers: { "Content-Type": "application/json" }
  });
});