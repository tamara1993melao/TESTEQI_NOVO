/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Se usar Expo aqui (provável que não):
// import { Expo } from "https://esm.sh/expo-server-sdk@3.7.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEBUG_PARAM = "debug";
const INTERNAL_NOTIFY_SECRET = Deno.env.get("INTERNAL_NOTIFY_SECRET") || "";
const MIN_RANK_DROP_DIFF = Number(Deno.env.get("MIN_RANK_DROP_DIFF") || 1);
const RANK_DROP_SUPPRESS_HOURS = Number(Deno.env.get("RANK_DROP_SUPPRESS_HOURS") || 6);

interface GameSpec {
  key: string;
  table: string;
  select: string;
  segmentField?: string;
  segments?: string[];
  orders: { col: string; asc: boolean }[];
  limit?: number;
}

const GAMES: GameSpec[] = [
  {
    key: "thinkfast",
    table: "thinkfast_leaderboard",
    select: "user_id,user_name,total_count,percent,avg_ms,best_single_ms,created_at",
    orders: [
      { col: "total_count", asc: false },
      { col: "percent", asc: false },
      { col: "avg_ms", asc: true },
      { col: "best_single_ms", asc: true },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "thinkfast90",
    table: "thinkfast90_leaderboard", // Adicione esta linha!
    select: "user_id,user_name,percent,avg_ms,best_single_ms,created_at",
    orders: [
      { col: "percent", asc: false },
      { col: "avg_ms", asc: true },
      { col: "best_single_ms", asc: true },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "sequences",
    table: "sequences_results_best",
    select: "user_id,user_name,level,percent,time_total_s,avg_time_s,created_at",
    segmentField: "level",
    segments: ["facil","medio","dificil"],
    orders: [
      { col: "percent", asc: false },
      { col: "time_total_s", asc: true },
      { col: "avg_time_s", asc: true },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "procurarSimbolos",
    table: "procurar_simbolos_results_best",
    select: "user_id,user_name,level,percent,time_total_s,avg_time_s,score,created_at",
    segmentField: "level",
    segments: ["facil","medio","dificil"],
    orders: [
      { col: "percent", asc: false },
      { col: "time_total_s", asc: true },
      { col: "avg_time_s", asc: true },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "matrices",
    table: "matrices_leaderboard",
    select: "user_id,user_name,score,time_ms,created_at",
    orders: [
      { col: "score", asc: false },
      { col: "time_ms", asc: true },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "adivinhe",
    table: "personalities_adivinhe_leaderboard",
    select: "user_id,user_name,score,created_at",
    orders: [
      { col: "score", asc: false },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "iq",
    table: "personalities_iq_leaderboard",
    select: "user_id,user_name,score,created_at",
    orders: [
      { col: "score", asc: false },
      { col: "created_at", asc: true }
    ],
    limit: 50
  },
  {
    key: "connections",
    table: "personalities_connections_leaderboard",
    select: "user_id,user_name,score,created_at",
    orders: [
      { col: "score", asc: false },
      { col: "created_at", asc: true }
    ],
    limit: 50
  }
];

function failEarly(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 500,
    headers: { "Content-Type": "application/json" }
  });
}

if (!SUPABASE_URL) {
  Deno.serve(() => failEarly("Missing SUPABASE_URL"));
} else if (!SERVICE_KEY) {
  Deno.serve(() => failEarly("Missing SUPABASE_SERVICE_ROLE_KEY"));
} else {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const FUNCTION_VERSION = "v11";

  async function fetchRanks(spec: GameSpec, segment?: string) {
    let q = supabase.from(spec.table).select(spec.select).limit(spec.limit || 50);
    if (spec.segmentField && segment) q = q.eq(spec.segmentField, segment);
    spec.orders.forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
    const { data, error } = await q;
    if (error) throw new Error(`[fetchRanks:${spec.key}:${segment ?? "_"}] ${error.message}`);
    return (data || []).map((row: any, i: number) => ({
      rank: i + 1,
      user_id: row.user_id,
      user_name: row.user_name
    }));
  }

  async function processGame(runId: string, spec: GameSpec, log: (...a:any[]) => void) {
    const segs = spec.segmentField ? (spec.segments || []) : [undefined];

    for (const seg of segs) {
      const segKey = (seg ?? "_").trim() || "_";
      log("[game:start]", spec.key, segKey);

      let ranks: { rank:number; user_id:string; user_name:string }[] = [];
      try {
        ranks = await fetchRanks(spec, seg);
      } catch (e:any) {
        log("[error:fetch]", spec.key, segKey, e.message);
        log("[game:end]", spec.key, segKey);
        continue;
      }

      log("[ranks]", spec.key, segKey, ranks.length);
      if (!ranks.length) {
        log("[skip:noRanks]", spec.key, segKey);
        log("[game:end]", spec.key, segKey);
        continue;
      }

      // -------- HISTÓRICO COMPLETO --------
      const historyRows = ranks
        .filter(r => r.user_id && String(r.user_id).trim().length === 36)
        .map(r => ({
          run_id: runId,
          game: spec.key.trim(),
          segment: segKey,
          user_id: String(r.user_id).trim(),
          rank_pos: r.rank
        }));
      log("[hist:prep]", spec.key, segKey, "rows:", historyRows.length);
      if (historyRows.length) {
        const { error: histErr } = await supabase
          .from("user_leaderboard_positions")
          .insert(historyRows);
        if (histErr) log("[error:positions-insert]", spec.key, segKey, histErr.message);
        else log("[positions:inserted]", spec.key, segKey, historyRows.length);
      }

      // -------- CONDENSAR MELHOR POSIÇÃO POR USER --------
      const bestByUser = new Map<string, { rank:number; user_id:string; user_name:string }>();
      for (const r of ranks) {
        const uid = (r.user_id || "").trim();
        if (uid.length !== 36) continue;
        const prev = bestByUser.get(uid);
        if (!prev || r.rank < prev.rank) bestByUser.set(uid, r);
      }
      const condensed = Array.from(bestByUser.values());

      const summaryUpdates = condensed.map(r => ({
        user_id: r.user_id.trim(),
        game: spec.key.trim(),
        segment: segKey,
        last_rank: r.rank
      }));

      if (!summaryUpdates.length) {
        log("[summary:empty]", spec.key, segKey);
        log("[game:end]", spec.key, segKey);
        continue;
      }

      // DEDUPE DEFENSIVO
      const map = new Map<string, typeof summaryUpdates[0]>();
      for (const u of summaryUpdates) {
        const k = `${u.user_id}|${u.game}|${u.segment}`;
        const ex = map.get(k);
        if (!ex || u.last_rank < ex.last_rank) map.set(k, u);
      }
      const unique = Array.from(map.values());

      log("[summary:counts]", spec.key, segKey, "raw:", summaryUpdates.length, "unique:", unique.length);
      log("[summary:preview]", spec.key, segKey, JSON.stringify(unique.slice(0,3)));

      // --- DETECTA QUEDA DE RANK ---
      const userIds = unique.map(u => u.user_id);
      const previous = await getPreviousRanks(spec, segKey, userIds);

      let drops = unique
        .map(u => {
          const oldRank = previous[u.user_id];
          const newRank = u.last_rank;
          if (oldRank && newRank > oldRank) {
            const diff = newRank - oldRank;
            if (diff >= MIN_RANK_DROP_DIFF) {
              return { user_id: u.user_id, game: u.game, segment: u.segment, old_rank: oldRank, new_rank: newRank, diff };
            }
          }
          return null;
        })
        .filter(Boolean) as any[];

      if (drops.length) {
        drops = await filterSuppressRecent(spec, segKey, drops);
      }
      if (drops.length) log("[rank:drops]", spec.key, segKey, drops.length);
      else log("[rank:drops:none]", spec.key, segKey);

      // --- UPSERT RESUMO ---
      const { error: upErr } = await supabase
        .from("user_leaderboard_ranks")
        .upsert(unique);

      if (upErr) {
        log("[error:upsert-summary]", spec.key, segKey, upErr.message);
        if (upErr.message.includes("cannot affect row a second time")) {
          log("[fallback:per-row]", spec.key, segKey);
          for (const u of unique) {
            const { error: oneErr } = await supabase
              .from("user_leaderboard_ranks")
              .upsert([u]);
            if (oneErr) log("[error:upsert-one]", spec.key, segKey, u.user_id, oneErr.message);
          }
        }
      } else {
        log("[summary:upsert-ok]", spec.key, segKey, unique.length);
        if (drops.length) {
          await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "rank_drop_batch",
              game: spec.key,
              segment: segKey,
              drops // cada item: { user_id, old_rank, new_rank, diff }
            })
          });
        }
      }

      const { data: verify, error: verErr } = await supabase
        .from("user_leaderboard_ranks")
        .select("user_id")
        .eq("game", spec.key)
        .eq("segment", segKey)
        .limit(3);
      if (verErr) log("[error:verify]", spec.key, segKey, verErr.message);
      else log("[verify]", spec.key, segKey, "sample:", verify?.length || 0);

      log("[game:end]", spec.key, segKey);
    }
  }

  async function getPreviousRanks(spec: GameSpec, segKey: string, userIds: string[]) {
    if (!userIds.length) return {};
    const { data, error } = await supabase
      .from("user_leaderboard_ranks")
      .select("user_id,last_rank")
      .eq("game", spec.key)
      .eq("segment", segKey)
      .in("user_id", userIds);
    if (error) return {};
    const map: Record<string, number> = {};
    for (const r of data) map[r.user_id] = r.last_rank;
    return map;
  }

  async function filterSuppressRecent(spec: GameSpec, segKey: string, drops: any[]) {
    // Se não existir tabela notifications, apenas retorna drops.
    if (!drops.length) return drops;
    const cutoff = new Date(Date.now() - RANK_DROP_SUPPRESS_HOURS * 3600_000).toISOString();
    const userIds = Array.from(new Set(drops.map(d => d.user_id)));
    const { data, error } = await supabase
      .from("notifications")
      .select("user_id")
      .eq("type", "rank_drop")
      .eq("game", spec.key)
      .eq("segment", segKey)
      .gte("created_at", cutoff)
      .in("user_id", userIds);
    if (error || !data) return drops;
    const recent = new Set(data.map(d => d.user_id));
    return drops.filter(d => !recent.has(d.user_id));
  }

  async function enqueueRankDropNotifications(spec: GameSpec, segKey: string, drops: any[], log: (...a:any[])=>void) {
    if (!drops.length) return;
    if (!INTERNAL_NOTIFY_SECRET) {
      log("[notify:skip:no_secret]", spec.key, segKey);
      return;
    }
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${INTERNAL_NOTIFY_SECRET}`
        },
        body: JSON.stringify({
          type: "rank_drop_batch",
            game: spec.key,
            segment: segKey,
            drops
        })
      });
      log("[notify:enqueue]", spec.key, segKey, "status", resp.status, "count", drops.length);
    } catch(e:any) {
      log("[error:notify:enqueue]", spec.key, segKey, e.message);
    }
  }

  Deno.serve(async req => {
    console.log("[version]", FUNCTION_VERSION);
    const url = new URL(req.url);
    const gameFilter = url.searchParams.get("game"); // opcional ?game=thinkfast
    const debug = url.searchParams.get("debug") === "1" || url.searchParams.get("DEBUG") === "1";
    const captured:string[] = [];
    const log = (...a:any[]) => {
      console.log(...a);
      if (debug) captured.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "));
    };
    try {
      log("[start]");
      const runId = crypto.randomUUID();
      log("[run]", runId);
      for (const g of GAMES) {
        if (gameFilter && g.key !== gameFilter) continue;
        await processGame(runId, g, log);
      }
      log("[done]");
      const res:any = { ok:true };
      if (debug) res.logs = captured;
      return new Response(JSON.stringify(res), { headers:{ "Content-Type":"application/json" } });
    } catch(e:any) {
      log("[fatal]", e?.message);
      const res:any = { ok:false, error:String(e) };
      if (debug) res.logs = captured;
      return new Response(JSON.stringify(res), {
        status:500,
        headers:{ "Content-Type":"application/json" }
      });
    }
  });
// <--- fecha o else iniciado após verificar SUPABASE_URL / SERVICE_KEY
}
