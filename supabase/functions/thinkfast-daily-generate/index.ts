/// <reference lib="deno.ns" />
import { createClient } from "jsr:@supabase/supabase-js@2";

// Variáveis ambiente
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

type Mode  = 'max_targets_time' | 'click_only' | 'avoid_colors';
type Group = 'A'|'B'|'C';

interface RuleResponse {
  day: string;
  group_code: Group;
  mode: Mode;
  config: Record<string,unknown>;
  generated_at: string;
  test?: boolean;
  variant_id?: string;
}

// Paleta base (mantida)
const BASE_COLORS = [
'#e9170cff', // vermelho
'#21b90dff', // verde
'#0004FFFF', // azul
'#ff7300ff', // laranja
'#921aceff', // roxo
'#c9f503f3', // amarelo
'#1bc8ceff', // ciano
'#FFFFFFFF' // branco
];

// Utils
function randInt(min:number,max:number){ return Math.floor(Math.random()*(max-min+1))+min; }
function shuffle<T>(arr:T[]):T[]{ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function sample<T>(arr:T[], n:number){ return shuffle(arr).slice(0,n); }

function pickGroup(prevGroups: string[]): Group {
  const all: Group[] = ['A','B','C'];
  const distinct = [...new Set(prevGroups)];
  if (distinct.length === 2) {
    return all.find(g=>!distinct.includes(g)) as Group;
  }
  return all[Math.floor(Math.random()*all.length)];
}

// Geradores por grupo
function genGroupA(){
  const colorsShuffled = shuffle(BASE_COLORS);
  const forbiddenCount = randInt(1,3);
  const forbidden = colorsShuffled.slice(0, forbiddenCount);
  const allowed   = colorsShuffled.slice(forbiddenCount);
  const time_limit = randInt(28,40);

  // NOVO: variante de velocidade
  const pace_variant = Math.random() < 0.5 ? 'medium' : 'fast';
  let spawn_min:number, spawn_max:number, ttl_ms:number, concurrent:number;
  if (pace_variant === 'medium') {
    spawn_min = 170;         // intervalo maior = menos pressão
    spawn_max = 360;
    ttl_ms    = 1850;
    concurrent = 3;
  } else {
    spawn_min = 120;
    spawn_max = 280;
    ttl_ms    = 1650;
    concurrent = 4;
  }

  return {
    group:'A' as Group,
    mode:'click_only' as Mode,
    config:{
      colors: colorsShuffled,
      forbiddenColors: forbidden,
      allowedColors: allowed,
      timed:true,
      time_limit,
      errors_limit:999,
      scoring:{ correct:1, wrong:-1 },
      // NOVOS CAMPOS
      pace_variant,
      spawn_min,
      spawn_max,
      ttl_ms,
      concurrent,
      description:`Clique apenas nas cores permitidas (${pace_variant==='medium'?'Velocidade Média':'Velocidade Rápida'}). Erro -1. Tempo: ${time_limit}s`
    }
  };
}
function genGroupB(){
  const colorsShuffled = shuffle(BASE_COLORS);
  const forbiddenCount = randInt(1,3);
  const forbidden = colorsShuffled.slice(0, forbiddenCount);
  const allowed   = colorsShuffled.slice(forbiddenCount);
  const time_limit = randInt(28,40);

  const pace_variant = Math.random() < 0.5 ? 'medium' : 'fast';
  let spawn_min:number, spawn_max:number, ttl_ms:number, concurrent:number;
  if (pace_variant === 'medium') {
    spawn_min = 180;
    spawn_max = 370;
    ttl_ms    = 1900;
    concurrent = 3;
  } else {
    spawn_min = 125;
    spawn_max = 290;
    ttl_ms    = 1650;
    concurrent = 4;
  }

  return {
    group:'B' as Group,
    mode:'avoid_colors' as Mode,
    config:{
      colors: colorsShuffled,
      forbiddenColors: forbidden,
      allowedColors: allowed,
      timed:true,
      time_limit,
      errors_limit:999,
      scoring:{ correct:1, wrong:-5 },
      pace_variant,
      spawn_min,
      spawn_max,
      ttl_ms,
      concurrent,
      description:`Não clique nas proibidas (${pace_variant==='medium'?'Médio':'Rápido'}). Erro -5. Tempo: ${time_limit}s`
    }
  };
}
function genGroupC(){
  const time_limit = randInt(28,40);
  // Modo mais frenético
  const spawn_min = 70;
  const spawn_max = 160;
  const ttl_ms    = 1500;
  const concurrent = randInt(7,9);
  return {
    group:'C' as Group,
    mode:'max_targets_time' as Mode,
    config:{
      time_limit,
      timed:true,
      scoring:{ per_target:1 },
      spawn_min,
      spawn_max,
      ttl_ms,
      concurrent,
      description:`Estoure o máximo em ${time_limit}s (Rápido)`
    }
  };
}

function generateByGroup(g:Group){
  if (g==='A') return genGroupA();
  if (g==='B') return genGroupB();
  return genGroupC();
}
function generateByMode(m:Mode){
  if (m==='click_only') return genGroupA();
  if (m==='avoid_colors') return genGroupB();
  return genGroupC();
}

async function getOrCreateToday(force:boolean, explicitGroup?:Group, explicitMode?:Mode): Promise<RuleResponse> {
  const today = new Date().toISOString().slice(0,10);

  if (!force && !explicitGroup && !explicitMode) {
    const { data: existing } = await supabase
      .from('thinkfast_daily_config')
      .select('day,group_code,mode,config')
      .eq('day', today)
      .maybeSingle();
    if (existing) {
      return {
        day: existing.day,
        group_code: existing.group_code as Group,
        mode: existing.mode as Mode,
        config: existing.config as Record<string,unknown>,
        generated_at: new Date().toISOString()
      };
    }
  }

  let picked;
  if (explicitMode) picked = generateByMode(explicitMode);
  else if (explicitGroup) picked = generateByGroup(explicitGroup);
  else {
    const { data: lastConfigs } = await supabase
      .from('thinkfast_daily_config')
      .select('group_code,day')
      .lt('day', today)
      .order('day', { ascending:false })
      .limit(2);
    const prevGroups = (lastConfigs||[]).map(r=>r.group_code);
    const g = pickGroup(prevGroups);
    picked = generateByGroup(g);
  }

  const upsertPayload = {
    day: today,
    group_code: picked.group,
    mode: picked.mode,
    config: picked.config
  };

  const { error } = await supabase
    .from('thinkfast_daily_config')
    .upsert(upsertPayload, { onConflict:'day' });
  if (error) console.error('Erro ao salvar:', error);

  return {
    day: today,
    group_code: picked.group,
    mode: picked.mode,
    config: picked.config,
    generated_at: new Date().toISOString()
  };
}

function buildVariant(base:{group:Group;mode:Mode;config:Record<string,unknown>}, test:boolean):RuleResponse{
  const day = new Date().toISOString().slice(0,10);
  return {
    day,
    group_code: base.group,
    mode: base.mode,
    config: base.config,
    generated_at: new Date().toISOString(),
    test,
    variant_id: crypto.randomUUID()
  };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const test = url.searchParams.get('test') === '1';
    const testMultiRaw = url.searchParams.get('test_multi');
    const force = url.searchParams.get('force') === '1';
    const groupParam = url.searchParams.get('group');
    const modeParam  = url.searchParams.get('mode');

    const explicitGroup = (groupParam && ['A','B','C'].includes(groupParam)) ? groupParam as Group : undefined;
    const explicitMode  = (modeParam  && ['click_only','avoid_colors','max_targets_time'].includes(modeParam))
      ? modeParam as Mode : undefined;

    // Múltiplas variantes de teste (não persiste)
    if (testMultiRaw) {
      const n = Math.min(Math.max(parseInt(testMultiRaw,10)||1,1), 15);
      const variants: RuleResponse[] = [];
      for (let i=0;i<n;i++){
        let base;
        if (explicitMode) base = generateByMode(explicitMode);
        else if (explicitGroup) base = generateByGroup(explicitGroup);
        else {
          const g:Group = ['A','B','C'][Math.floor(Math.random()*3)] as Group;
          base = generateByGroup(g);
        }
        variants.push(buildVariant(base, true));
      }
      return json({ day: new Date().toISOString().slice(0,10), count: variants.length, variants }, 200, true);
    }

    // Teste simples (1 variante, não persiste)
    if (test) {
      let base;
      if (explicitMode) base = generateByMode(explicitMode);
      else if (explicitGroup) base = generateByGroup(explicitGroup);
      else {
        const g:Group = ['A','B','C'][Math.floor(Math.random()*3)] as Group;
        base = generateByGroup(g);
      }
      return json(buildVariant(base, true), 200, true);
    }

    // Oficial (persiste ou reutiliza)
    const official = await getOrCreateToday(force, explicitGroup, explicitMode);
    return json(official, 200, true);

  } catch (e) {
    return json({ error:(e as Error).message }, 500, true);
  }
});

function json(data:unknown, status=200, noStore=false){
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'Content-Type':'application/json',
      'Cache-Control': noStore ? 'no-store, max-age=0' : 'public, max-age=60'
    }
  });
}