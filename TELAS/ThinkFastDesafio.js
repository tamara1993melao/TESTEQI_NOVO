import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet, Modal, Animated,
  ActivityIndicator, Alert, ScrollView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { supabase } from '../supabaseClient';
import * as Notifications from 'expo-notifications';
import { schedulePostGameReminder } from '../utils/notifications';

let ConfettiCannon;
try {
  ConfettiCannon = require('react-native-confetti-cannon').default;
} catch {
  ConfettiCannon = () => null;
}

const COLORS = ['#00d3aa', '#ffd166', '#e74c3c', '#3498db', '#9b59b6', '#1abc9c', '#ff6b6b', '#f1c40f'];
const rand = (a, b) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const MEDAL_EMOJI = { 1:'🥇', 2:'🥈', 3:'🥉' };

async function fetchProfileAndSet(setDisplayName, setUserId) {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) { setDisplayName('Convidado'); setUserId(null); return; }
    setUserId(u.id);
    const meta = u.user_metadata || {};
    const { data: p } = await supabase
      .from('profiles')
      .select('nickname,name,username')
      .eq('id', u.id)
      .maybeSingle();
    const display =
      (p?.nickname && p.nickname.trim()) ||
      (p?.name && p.name.trim()) ||
      (meta.nickname && meta.nickname.trim()) ||
      (meta.full_name && meta.full_name.trim()) ||
      (p?.username && p.username.trim()) ||
      (u.email ? u.email.split('@')[0] : 'Você');
    setDisplayName(display);
  } catch {
    setDisplayName('Você');
    setUserId(null);
  }
}

// Sons
function useEndSounds() {
  const soundsRef = useRef({ victory: null, defeat: null });
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
      } catch {}
      try {
        const victory = new Audio.Sound();
        const defeat = new Audio.Sound();
        await victory.loadAsync(require('../assets/vitoria.mp3'), { volume: 1.0, shouldPlay: false });
        await defeat.loadAsync(require('../assets/derrota.mp3'), { volume: 1.0, shouldPlay: false });
        if (mounted) soundsRef.current = { victory, defeat };
      } catch (e) { console.log('[Som] falha', e); }
    })();
    return () => {
      mounted = false;
      Object.values(soundsRef.current).forEach(s => s && s.unloadAsync());
    };
  }, []);
  const play = async (k) => {
    const s = soundsRef.current[k];
    if (!s) return;
    try { await s.stopAsync(); await s.setPositionAsync(0); await s.playAsync(); } catch {}
  };
  return { playVictory: () => play('victory') };
}

// Texto amigável da regra
function formatRule(rule) {
  if (!rule) return 'Carregando...';
  const rt = rule.rule_type || rule.mode;
  if (rt === 'max_targets_time') return `Estoure o máximo de bolinhas em ${rule.params.seconds}s`;
  if (rt === 'apenas_cor' || rt === 'click_only') {
    const nForb = (rule.params.forbiddenColors||[]).length;
    return `Clique só nas cores permitidas (${nForb} proibida${nForb>1?'s':''})`;
  }
  if (rt === 'evitar_cor' || rt === 'avoid_colors') {
    const n = (rule.params.forbiddenColors||[]).length;
    return `NÃO clique em ${n} cor${n>1?'es':''} proibida${n>1?'s':''}`;
  }
  if (rt === 'duas_cores') return 'Clique somente nas duas cores alvo';
  return 'Desafio surpresa';
}

// Avalia toque
function evaluateHit(rule, color, wasTap) {
  if (!rule) return { valid: true, penalty: false };
  if (!wasTap) return { valid: false, penalty: true };
  const rt = rule.rule_type || rule.mode;
  if (rt === 'max_targets_time') return { valid: true, penalty: false };

  if (rt === 'apenas_cor' || rt === 'click_only') {
    const allowed = (rule.params.allowedColors && rule.params.allowedColors.length)
      ? rule.params.allowedColors
      : null; // null = permitir tudo (evita score zero por config vazia)
    if (!allowed) return { valid:true, penalty:false };
    const ok = allowed.includes(color);
    return { valid: ok, penalty: !ok };
  }
  if (rt === 'evitar_cor' || rt === 'avoid_colors') {
    const forbidden = (rule.params.forbiddenColors && rule.params.forbiddenColors.length)
      ? rule.params.forbiddenColors
      : [];
    const bad = forbidden.includes(color);
    return { valid: !bad, penalty: bad };
  }
  if (rt === 'duas_cores') {
    const allowed = rule.params.colors || [];
    if (!allowed.length) return { valid:true, penalty:false };
    const ok = allowed.includes(color);
    return { valid: ok, penalty: !ok };
  }
  return { valid: true, penalty: false };
}

function getRuleKind(rule){
  return rule ? (rule.rule_type || rule.mode) : null;
}
function scoringFor(rule){
  const kind = getRuleKind(rule);
  switch(kind){
    case 'max_targets_time': return { hit:+1, penalty:0 };
    case 'apenas_cor':
    case 'click_only':
    case 'duas_cores':      return { hit:+1, penalty:-1 };
    case 'evitar_cor':
    case 'avoid_colors':    return { hit:+1, penalty:-5 };
    default:                return { hit:+1, penalty:-1 };
  }
}

// Cálculo de score
function calcScore(rule, hits, penalties) {
  if (!rule) return hits;
  const rt = rule.rule_type || rule.mode;
  switch (rt) {
    case 'max_targets_time': return hits;
    case 'apenas_cor':
    case 'click_only':       return hits - penalties;
    case 'evitar_cor':
    case 'avoid_colors':     return hits - penalties * 5;
    case 'duas_cores':       return hits - penalties;
    default: return hits;
  }
}

export default function ThinkFastDesafio({ navigation }) {
  const [displayName, setDisplayName] = useState('Convidado');
  const [userId, setUserId] = useState(null);

  const [rule, setRule] = useState(null);
  const [loadingRule, setLoadingRule] = useState(true);
  const [ruleError, setRuleError] = useState(null);

  const [targets, setTargets] = useState([]);
  const targetsRef = useRef([]);
  useEffect(() => { targetsRef.current = targets; }, [targets]);

  const [showIntro, setShowIntro] = useState(true);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  useEffect(() => { runningRef.current = running; }, [running]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const [countdown, setCountdown] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [penalties, setPenalties] = useState(0);
  const [times, setTimes] = useState([]);
  const timesRef = useRef([]);
  useEffect(() => { timesRef.current = times; }, [times]);

  const cfgRef = useRef({
    size: 60,
    spawnMin: 320,
    spawnMax: 950,
    ttl: 2000,
    concurrent: 4
  });

  const [hapticsOn, setHapticsOn] = useState(true);
  const safeHaptic = () => { if (hapticsOn) try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} };

  const spawnTimerRef = useRef(null);
  const ttlTimersRef = useRef({});
  const challengeTimerRef = useRef(null);

  const [showResults, setShowResults] = useState(false);
  const [finalSessionData, setFinalSessionData] = useState(null);
  const [history, setHistory] = useState({ attempts: 0, successes: 0, lastAt: null });

  const [leaderboard, setLeaderboard] = useState([]);
  const [showRanking, setShowRanking] = useState(false);
  const [avgResult, setAvgResult] = useState(null);
  const [myPlacement, setMyPlacement] = useState(null);

  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  const [dailyLimit, setDailyLimit] = useState(null);
  const [attemptsToday, setAttemptsToday] = useState(0);
  const [medals, setMedals] = useState({ gold:0, silver:0, bronze:0 });

  const [currentScore, setCurrentScore] = useState(0);
  // Refs para evitar valores “stale” em finishGame
  const currentScoreRef = useRef(0);
  const hitsRef        = useRef(0);
  const penaltiesRef   = useRef(0);
  const missesRef      = useRef(0);

  const sessionRef = useRef(null);

  useEffect(()=>{ currentScoreRef.current = currentScore; }, [currentScore]);
  useEffect(()=>{ hitsRef.current = hits; }, [hits]);
  useEffect(()=>{ penaltiesRef.current = penalties; }, [penalties]);
  useEffect(()=>{ missesRef.current = misses; }, [misses]);
  useEffect(()=>{ timesRef.current = times; }, [times]);

  const [debugInfo, setDebugInfo] = useState({ spawns:0, clicks:0 }); // <--- ADICIONADO
  const [submitStatus, setSubmitStatus] = useState(null);

  const { playVictory } = useEndSounds();
  const introAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(introAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start(); }, []);

  useEffect(() => { fetchProfileAndSet(setDisplayName, setUserId); }, []);
  // carregar medalhas quando usuário já existir
  useEffect(()=>{
    if (userId) {
      loadMedals();       // inicial
      loadLeaderboard();  // opcional sincronizar
    }
  }, [userId, loadMedals, loadLeaderboard]);

  // History
  useEffect(() => { loadHistory(); loadRule(); }, []);
  const loadHistory = async () => {
    try {
      const raw = await AsyncStorage.getItem('thinkfast:desafio:history');
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  };
  const saveHistory = async (h) => {
    setHistory(h);
    try { await AsyncStorage.setItem('thinkfast:desafio:history', JSON.stringify(h)); } catch {}
  };

  // Regra
  const loadRule = async (forceNew = false, explicitMode) => {
    setLoadingRule(true); setRuleError(null);
    try {
      const base = process.env.EXPO_PUBLIC_SUPABASE_URL || supabase?.supabaseUrl;
      const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!base) throw new Error('Config faltando');
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const qsParts = [];
      if (forceNew) qsParts.push('test=1');
      if (explicitMode) qsParts.push(`mode=${encodeURIComponent(explicitMode)}`);
      qsParts.push(`cb=${Date.now()}`);
      const qs = '?' + qsParts.join('&');
      const url = `${base.replace(/\/$/,'')}/functions/v1/thinkfast-daily-generate${qs}`;
      const headers = { apikey: anon || '' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(await r.text());
      const raw = await r.json();
      const norm = normalizeRule(raw);
      setRule(norm);
      if (forceNew) console.log('[ThinkFast] Novo teste', norm);
    } catch (e) {
      console.log('Erro carregar regra', e);
      setRuleError('Falha ao carregar desafio.');
    } finally {
      setLoadingRule(false);
    }
  };

  // Ajuste config conforme regra
  useEffect(() => {
    if (!rule) return;
    const cfg = { ...cfgRef.current };
    switch (rule.rule_type) {
      case 'max_targets_time':
        cfg.size=56; cfg.spawnMin=90; cfg.spawnMax=220; cfg.ttl=1600; cfg.concurrent=8; break;
      case 'apenas_cor':
        cfg.size=58; cfg.spawnMin=140; cfg.spawnMax=360; cfg.ttl=1800; cfg.concurrent=6; break;
      case 'evitar_cor':
        cfg.size=58; cfg.spawnMin=150; cfg.spawnMax=380; cfg.ttl=1800; cfg.concurrent=6; break;
      case 'duas_cores':
        cfg.size=58; cfg.spawnMin=130; cfg.spawnMax=340; cfg.ttl=1750; cfg.concurrent=7; break;
      default:
        cfg.size=58; cfg.spawnMin=150; cfg.spawnMax=400; cfg.ttl=1900; cfg.concurrent=5;
    }
    cfgRef.current = cfg;
  }, [rule]);

  // Leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      const day = new Date().toISOString().slice(0,10);
      const { data, error } = await supabase
        .from('thinkfast_daily_leaderboard')
        .select('user_id,user_name,score,rank,day,accuracy')
        .eq('day', day)
        .order('rank', { ascending: true })
        .limit(5);
      if (error) { console.log('[Desafio] leaderboard error', error.message); return; }
      const rows = data || [];
      setLeaderboard(rows);
      if (userId) {
        const me = rows.find(r => r.user_id === userId);
        setMyPlacement(me?.rank || null);
      } else setMyPlacement(null);
      if (rows.length) {
        const avg = Math.round(rows.reduce((a,r)=>a+(r.score||0),0)/rows.length);
        setAvgResult(avg);
      } else setAvgResult(null);
    } catch (e) { console.log('[Desafio] leaderboard exception', e); }
  }, [userId]);

  // Medals
  const loadMedals = useCallback(async ()=>{
    try {
      if(!userId){ setMedals({gold:0,silver:0,bronze:0}); return; }
      const { data, error } = await supabase
        .from('thinkfast_daily_leaderboard')
        .select('rank,day')
        .eq('user_id', userId);
      if(error){ return; }
      let g=0,s=0,b=0;
      (data||[]).forEach(r=>{
        if(r.rank===1) g++;
        else if(r.rank===2) s++;
        else if(r.rank===3) b++;
      });
      setMedals({ gold:g, silver:s, bronze:b });
    } catch {}
  }, [userId]);

  // Limite / tentativas
  useEffect(() => {
    (async () => {
      try {
        const { data: lim } = await supabase
          .from('limites_funcionalidades')
          .select('limite_free')
          .eq('codigo', 'THINKFAST_DESAFIO')
          .maybeSingle();
        setDailyLimit(lim?.limite_free ?? 3);

        if (userId) {
          const today = new Date().toISOString().slice(0,10);
            const { count } = await supabase
              .from('thinkfast_daily_attempts')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', userId)
              .eq('day', today);
            setAttemptsToday(count ?? 0);
        }
      } catch {
        setDailyLimit(3);
        setAttemptsToday(0);
      }
    })();
  }, [showIntro, showResults, userId]);

  // Cleanup tim ers
  const cleanupTimers = () => {
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    spawnTimerRef.current = null;
    Object.values(ttlTimersRef.current).forEach(t => clearTimeout(t));
    ttlTimersRef.current = {};
    if (challengeTimerRef.current) clearInterval(challengeTimerRef.current);
    challengeTimerRef.current = null;
  };

  const resetAll = () => {
    cleanupTimers();
    setTargets([]); setHits(0); setMisses(0); setPenalties(0); setTimes([]);
    setFinalSessionData(null); setCountdown(null); setTimeLeft(0);
    setCurrentScore(0);
    setSubmitStatus(null);
  };

  const startChallengeTimer = (seconds) => {
    setTimeLeft(seconds);
    challengeTimerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(challengeTimerRef.current);
          challengeTimerRef.current = null;
          finishGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startCountdown = () => {
    setCountdown(3); safeHaptic();
    let n = 3;
    const tick = () => {
      n -= 1; setCountdown(n);
      if (n <= 0) {
        setCountdown(null);
        setRunning(true); runningRef.current = true;
        setPaused(false); pausedRef.current = false;
        const dur = rule?.params?.seconds || (rule?.rule_type === 'max_targets_time' ? 30 : 30);
        sessionRef.current = {
          started_at: Date.now(),
          planned_seconds: dur
        };
        startChallengeTimer(dur);
        spawnLoop();
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  };

  const startGame = () => {
    if (loadingRule || !rule) { Alert.alert('Aguarde', 'Regra ainda carregando.'); return; }
    if (boardSize.w === 0 || boardSize.h === 0) { Alert.alert('Espere', 'Área de jogo preparando...'); return; }
    setShowRanking(false);
    setShowIntro(false);
    resetAll();
    startCountdown();
  };

  const chooseColor = () => {
    if (!rule) return COLORS[Math.floor(Math.random()*COLORS.length)];
    const rt = rule.rule_type || rule.mode;
    if (rt === 'apenas_cor' || rt === 'click_only') {
      const allowed = rule.params.allowedColors || COLORS;
      const others = (rule.params.forbiddenColors || []);
      if (Math.random() < 0.7 && allowed.length) {
        return allowed[Math.floor(Math.random()*allowed.length)];
      }
      const pool = COLORS.filter(c=>!allowed.includes(c) || others.includes(c));
      return pool[Math.floor(Math.random()*pool.length)] || allowed[0];
    }
    if (rt === 'evitar_cor' || rt === 'avoid_colors') {
      const forbidden = rule.params.forbiddenColors || [];
      if (Math.random() < 0.3 && forbidden.length) {
        return forbidden[Math.floor(Math.random()*forbidden.length)];
      }
      const pool = COLORS.filter(c=>!forbidden.includes(c));
      return pool[Math.floor(Math.random()*pool.length)] || COLORS[0];
    }
    if (rt === 'max_targets_time') {
      return COLORS[Math.floor(Math.random()*COLORS.length)];
    }
    return COLORS[Math.floor(Math.random()*COLORS.length)];
  };

  const spawnOne = () => {
    if (!runningRef.current) return;
    if (targetsRef.current.length >= cfgRef.current.concurrent) return;
    const bs = boardSize;
    if (bs.w <= 0 || bs.h <= 0) return;
    const size = cfgRef.current.size;
    const margin = 6;
    const maxW = Math.max(size, bs.w - size - margin);
    const maxH = Math.max(size, bs.h - size - margin);
    const id = uid();
    let x=margin,y=margin;
    for (let i=0;i<35;i++){
      const tx = margin + Math.random()*(maxW - margin);
      const ty = margin + Math.random()*(maxH - margin);
      const overlap = targetsRef.current.some(t=>{
        const dx=t.x-tx, dy=t.y-ty;
        return Math.sqrt(dx*dx+dy*dy) < size*0.9;
      });
      if (!overlap){ x=tx; y=ty; break; }
      if (i===34){ x=tx; y=ty; }
    }
    const color = chooseColor();
    const born = Date.now();
    const scale = new Animated.Value(0);
    const t = { id, x, y, color, born, scale };
    setDebugInfo(d=>({ ...d, spawns:d.spawns+1 }));
    setTargets(prev=>[...prev,t]);
    Animated.spring(scale,{ toValue:1, useNativeDriver:true, friction:6 }).start();
    const ttl = cfgRef.current.ttl;
    ttlTimersRef.current[id] = setTimeout(()=>{
      if (!runningRef.current) return;
      setTargets(prev=>{
        if (!prev.find(e=>e.id===id)) return prev;
        setMisses(m=>m+1);
        return prev.filter(e=>e.id!==id);
      });
    }, ttl);
  };

  const spawnLoop = () => {
    if (!runningRef.current || pausedRef.current) return;
    spawnOne();
    const { spawnMin, spawnMax } = cfgRef.current;
    const delay = Math.round(rand(spawnMin, spawnMax));
    spawnTimerRef.current = setTimeout(spawnLoop, delay);
  };

  const onTargetPress = (id) => {
    if (!runningRef.current || pausedRef.current) return;
    const now = Date.now();
    setTargets(prev=>{
      const t = prev.find(e=>e.id===id);
      if (!t) return prev;
      const dt = now - t.born;
      const { valid, penalty } = evaluateHit(rule, t.color, true);
      const scoring = scoringFor(rule);
      if (valid){
        setHits(h=>h+1);
        setTimes(tt=>[...tt, dt]);
        setCurrentScore(s=>s + scoring.hit);
      } else {
        setMisses(m=>m+1);
      }
      if (penalty){
        setPenalties(p=>p+1);
        if (scoring.penalty) setCurrentScore(s=>s + scoring.penalty);
      }
      setDebugInfo(d=>({ ...d, clicks:d.clicks+1 }));
      if (ttlTimersRef.current[id]) { clearTimeout(ttlTimersRef.current[id]); delete ttlTimersRef.current[id]; }
      return prev.filter(e=>e.id!==id);
    });
  };

  const pauseResume = () => {
    if (!running) return;
    if (!paused) { setPaused(true); cleanupTimers(); }
    else { setPaused(false); startChallengeTimer(timeLeft); spawnLoop(); }
  };

  const computeStats = useCallback(arr=>{
    if (!arr.length) return { count:0, avg:null, med:null, sd:null, best:null };
    const avg = Math.round(arr.reduce((a,b)=>a+b,0)/arr.length);
    const sorted = arr.slice().sort((a,b)=>a-b);
    const mid = Math.floor(sorted.length/2);
    const med = sorted.length%2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2);
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    const sd = Math.round(Math.sqrt(arr.reduce((a,b)=>a+(b-mean)**2,0)/arr.length));
    const best = Math.min(...arr);
    return { count:arr.length, avg, med, sd, best };
  }, []);

  const reactionStats = useMemo(()=>computeStats(times), [times, computeStats]);
  const accuracy = (hits+misses)>0 ? Math.round((hits/(hits+misses))*100) : 0;

  const finishGame = useCallback(async () => {
    cleanupTimers();
    setRunning(false); setPaused(false);

    // Coleta final via refs
    const finalHits      = hitsRef.current;
    const finalPenalties = penaltiesRef.current;
    const finalMisses    = missesRef.current;
    const finalTimes     = [...timesRef.current];
    const score          = currentScoreRef.current;

    // Recalcula accuracy e stats finais (caso tenha mudado entre último render)
    const finalAccuracy = (finalHits + finalMisses) > 0
      ? Math.round((finalHits / (finalHits + finalMisses)) * 100)
      : 0;
    const rs = computeStats(finalTimes);

    // Duração efetiva
    const plannedMs = (sessionRef.current?.planned_seconds || 0) * 1000;
    const elapsedMs = sessionRef.current
      ? Math.min(Date.now() - sessionRef.current.started_at, plannedMs || (Date.now() - sessionRef.current.started_at))
      : plannedMs;

    if (__DEV__) console.log('[DBG] finishGame', {
      hits: finalHits,
      penalties: finalPenalties,
      misses: finalMisses,
      score,
      rule,
      timesLen: finalTimes.length,
      accuracy: finalAccuracy
    });

    const success = true;

    // Salva snapshot completo para modal
    setFinalSessionData({
      score,
      hits: finalHits,
      penalties: finalPenalties,
      misses: finalMisses,
      accuracy: finalAccuracy,
      avg: rs.avg,
      best: rs.best,
      med: rs.med,
      sd: rs.sd,
      duration_ms: elapsedMs
    });

    // Histórico local
    const h = {
      attempts: history.attempts + 1,
      successes: history.successes + (success ? 1 : 0),
      lastAt: Date.now()
    };
    saveHistory(h);

    playVictory();

    setSubmitStatus('enviando');

    try {
      const payload = {
        user_id: userId,
        user_name: displayName,
        mode: 'daily',
        score,
        success,
        duration_ms: elapsedMs,
        stats: {
          hits: finalHits,
          misses: finalMisses,
          penalties: finalPenalties,
          avg: rs.avg,
          best: rs.best,
          med: rs.med,
          sd: rs.sd,
          accuracy: finalAccuracy
        }
      };
      if (__DEV__) console.log('[ThinkFast][submit] payload', payload);

      let edgeOk = false;

      if (userId) {
        try {
          setSubmitStatus('edge...');
          const { data: resp, error } = await supabase.functions.invoke('thinkfast-submit', { body: payload });
          console.log('[ThinkFast][submit] edge resp', resp, error);
          if (error) throw error;
          edgeOk = true;
          setSubmitStatus('edge_ok');
          console.log('[ThinkFast][submit] edge_ok score', score);
          if (resp?.leaderboard) setLeaderboard(resp.leaderboard);
        } catch (e) {
          console.log('[ThinkFast][submit] edge falhou -> fallback', e?.message);
          setSubmitStatus('edge_falhou');
        }
      }

      if (!edgeOk && userId) {
        try {
          setSubmitStatus('fallback...');
          const day = new Date().toISOString().slice(0,10);
          const { data: insData, error: insErr } = await supabase
            .from('thinkfast_daily_attempts')
            .upsert({
              user_id: userId,
              user_name: displayName,
              day,
              score,
              success,
              duration_ms: elapsedMs,
              stats: payload.stats,
              mode: 'daily'
            }, { onConflict: 'day,user_id' })
            .select()
            .maybeSingle();
          if (insErr) {
            console.log('[ThinkFast][submit] fallback erro', insErr.message);
            setSubmitStatus('erro:' + insErr.message);
          } else {
            setSubmitStatus('fallback_ok');
            console.log('[ThinkFast][submit] fallback_ok score', score);
            if (insData) {
              setLeaderboard(prev => {
                const copy = prev.slice();
                const existing = copy.find(r => r.user_id === userId);
                if (existing) existing.score = score;
                else copy.push({
                  user_id: userId,
                  user_name: displayName,
                  score,
                  accuracy: finalAccuracy / 100,
                  rank: copy.length + 1,
                  day
                });
                return copy
                  .sort((a,b)=>(b.score||0)-(a.score||0))
                  .slice(0,5)
                  .map((r,i)=>({...r, rank:i+1}));
              });
            }
          }
        } catch (e) {
          console.log('[ThinkFast][submit] fallback exception', e?.message);
          setSubmitStatus('erro:' + e?.message);
        }
      }

      if (!userId) setSubmitStatus('skip_sem_login');
    } catch (e) {
      console.log('[ThinkFast][submit] geral erro', e);
      setSubmitStatus('erro:' + (e?.message || 'desconhecido'));
    }

    await loadLeaderboard();
    await loadMedals();
    setTimeout(()=>setShowResults(true), 120);
    try {
      schedulePostGameReminder(5); // 5 minutos (ajuste se quiser)
    } catch(e){
      if (__DEV__) console.log('[Notify] falhou', e.message);
    }
  // Dependências mínimas (não incluir hits/misses/penalties porque usamos refs)
  }, [rule, history, computeStats, playVictory, loadLeaderboard, loadMedals, userId, displayName]);

  const stopEarly = () => { if (running) finishGame(); };

  const ruleColors = useMemo(()=>{
    if (!rule) return [];
    const rt = rule.rule_type || rule.mode;
    if (rt === 'apenas_cor' || rt === 'click_only') return [...(rule.params.allowedColors||[])].slice(0,4);
    if (rt === 'evitar_cor' || rt === 'avoid_colors') return (rule.params.forbiddenColors||[]).slice(0,3);
    if (rt === 'duas_cores') return (rule.params.colors||[]).slice(0,2);
    return [];
  }, [rule]);

  useEffect(() => {
    (async () => {
      try {
        // registra sessão simples (userId pode ser null)
        await supabase.from('sessions_log').insert({ user_id: userId || null });
      } catch (e) {
        if (__DEV__) console.log('[sessions_log] falha', e.message);
      }
    })();
  }, [userId]);

  return (
    <LinearGradient colors={['#09131b','#102838','#153b54']} style={{ flex:1 }}>
      <SafeAreaView style={{ flex:1 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={()=>{ cleanupTimers(); navigation.goBack(); }} style={styles.iconBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
            <Text style={styles.title}>Desafio ThinkFast</Text>
          <View style={{ flexDirection:'row', gap:6 }}>
            <TouchableOpacity onPress={()=>setHapticsOn(h=>!h)} style={styles.iconBtn}>
              <Feather name="smartphone" size={18} color={hapticsOn ? '#00d3aa' : '#b2c7d3'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>loadRule(true)} style={styles.iconBtn}>
              <Feather name="refresh-ccw" size={18} color="#b2c7d3" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={()=>{
                loadLeaderboard();
                loadMedals();          // <-- garantir atualização de medalhas
                setShowRanking(true);
              }}
              style={styles.iconBtn}
            >
              <Feather name="bar-chart-2" size={18} color="#9ad8ff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Top info */}
        <View style={styles.topBar}>
          <Text style={styles.topTxt}>Jogador: {displayName}</Text>
          <Text style={styles.topTxt}>Histórico: {history.successes}/{history.attempts} ({history.attempts?Math.round((history.successes/history.attempts)*100):0}%)</Text>
        </View>

        {/* Regra */}
        <View style={styles.ruleCard}>
          {loadingRule && (
            <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
              <ActivityIndicator color="#ffd166" />
              <Text style={styles.ruleLoading}>Carregando desafio...</Text>
            </View>
          )}
          {!loadingRule && ruleError && <Text style={styles.ruleError}>{ruleError}</Text>}
          {!loadingRule && rule && (
            <>
              <Text style={styles.ruleTitle}>Desafio Diário</Text>
              <Text style={styles.ruleText}>{formatRule(rule)}</Text>
              {ruleColors.length>0 && (
                <View style={styles.colorsRow}>
                  {ruleColors.map(c=> <View key={c} style={[styles.colorDot,{ backgroundColor:c }]} />)}
                  {rule.rule_type==='evitar_cor' && <Text style={styles.avoidTxt}>Evite esta cor</Text>}
                </View>
              )}
              <Text style={styles.ruleHint}>Complete para aumentar sua taxa de sucesso. Pode jogar várias vezes (por enquanto).</Text>
            </>
          )}
        </View>

        {/* HUD */}
        {running && (
          <View style={styles.hudRow}>
            <Text style={styles.hudItem}>Tempo: {timeLeft}s</Text>
            <Text style={styles.hudItem}>Acertos: {hits}</Text>
            <Text style={styles.hudItem}>Erros: {misses}</Text>
            {/* <Text style={styles.hudItem}>Penal: {penalties}</Text> */}
            <Text style={styles.hudItem}>Score: {currentScore}</Text>
            {/* <Text style={styles.hudItem}>Alvos:{cfgRef.current.concurrent}</Text> */}
          </View>
        )}

        {/* Board */}
        <View
          style={styles.board}
          onLayout={e => {
            const { width, height } = e.nativeEvent.layout;
            setBoardSize({ w: width, h: height });
          }}
        >
          {targets.map(t=>(
            <Animated.View
              key={t.id}
              style={[
                styles.target,
                {
                  width:cfgRef.current.size,
                  height:cfgRef.current.size,
                  left:t.x, top:t.y,
                  borderRadius:cfgRef.current.size/2,
                  backgroundColor:t.color+'33',
                  borderColor:t.color,
                  transform:[{ scale:t.scale }]
                }
              ]}
            >
              <TouchableOpacity style={styles.hitArea} onPress={()=>onTargetPress(t.id)} activeOpacity={0.7} />
            </Animated.View>
          ))}

          {countdown!==null && (
            <View style={styles.countdownOverlay}>
              <Text style={styles.countdownText}>{countdown===0?'Vai!':countdown}</Text>
            </View>
          )}

          {running && paused && (
            <View style={styles.pauseOverlay}>
              <Feather name="pause" size={42} color="#fff" />
              <Text style={styles.pauseTxt}>Pausado</Text>
            </View>
          )}
        </View>

        {/* Controles */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.ctrlBtn, !running ? styles.btnStart : (paused ? styles.btnResume : styles.btnPause)]}
            onPress={!running ? startGame : pauseResume}
            disabled={loadingRule || !!ruleError}
            activeOpacity={0.9}
          >
            <Feather name={!running ? 'play' : (paused ? 'play' : 'pause')} size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>{!running ? (loadingRule ? '...' : 'Iniciar') : (paused ? 'Retomar' : 'Pausar')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.btnStop]}
            onPress={stopEarly}
            disabled={!running}
          >
            <Feather name="square" size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>Parar</Text>
          </TouchableOpacity>
        </View>

        {/* Intro */}
        {showIntro && (
          <View style={styles.introOverlay} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.introCard,
                {
                  transform:[
                    { translateY:introAnim.interpolate({ inputRange:[0,1], outputRange:[40,0] }) },
                    { scale:introAnim.interpolate({ inputRange:[0,1], outputRange:[0.94,1] }) }
                  ],
                  opacity:introAnim
                }
              ]}
            >
              <View style={{ flexDirection:'row', alignItems:'center', marginBottom:10 }}>
                <Feather name="zap" size={24} color="#ffd166" />
                <Text style={styles.introTitle}>Desafio ThinkFast</Text>
              </View>
              <ScrollView style={{ maxHeight:200 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.introText}>Desafio diário surpresa. Estatísticas diferentes para cada regra.</Text>
                <Text style={styles.introSection}>Como funciona</Text>
                <Text style={styles.introList}>
                  • O tipo de desafio muda a cada dia{'\n'}
                  • Pontuação = acertos - penalidades {'\n'}
                </Text>
                <Text style={styles.introSection}>Regra de Hoje</Text>
                <Text style={styles.ruleHighlight}>{formatRule(rule)}</Text>
                {ruleColors.length>0 && (
                  <View style={{ flexDirection:'row', marginTop:6, flexWrap:'wrap', gap:8 }}>
                    {ruleColors.map(c=> <View key={c} style={[styles.colorDot,{ width:26,height:26, borderRadius:13, backgroundColor:c }]} />)}
                  </View>
                )}
              </ScrollView>
              <TouchableOpacity
                style={[styles.playBtn,(loadingRule||ruleError)&&{ opacity:0.4 }]}
                onPress={startGame}
                disabled={loadingRule||!!ruleError}
              >
                <Feather name="play-circle" size={22} color="#0a0f12" />
                <Text style={styles.playBtnTxt}>{loadingRule?'...':'Começar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={()=>loadRule(true)}>
                <Text style={styles.secondaryBtnTxt}>Recarregar desafio</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={()=>setShowIntro(false)}>
                <Text style={styles.secondaryBtnTxt}>Fechar</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        {/* Resultados */}
        <Modal visible={showResults} transparent animationType="fade" onRequestClose={()=>setShowResults(false)}>
          <View style={styles.modalWrap}>
            {finalSessionData && (
              <View style={styles.resultsCard}>
                <Text style={styles.resultsTitle}>🎉 Parabéns!</Text>
                <Text style={styles.resSubtitle}>Desafio concluído</Text>
                <Text style={styles.resCongrats}>Confira seu desempenho e acompanhe medalhas no Perfil.</Text>
                <Text style={styles.sectionTitle}>Resumo</Text>
                <Row k="Regra" v={formatRule(rule)} />
                <Row k="Score" v={finalSessionData.score} />
                <Row k="Acertos" v={finalSessionData.hits} />
                <Row k="Erros" v={finalSessionData.misses} />
                <Row k="Penalidades" v={finalSessionData.penalties} />
                <Row k="Precisão" v={finalSessionData.accuracy + '%'} />
                <Row k="Média (ms)" v={finalSessionData.avg ?? '—'} />
                <Row k="Melhor (ms)" v={finalSessionData.best ?? '—'} />
                {/* <Row k="Mediana (ms)" v={finalSessionData.med ?? '—'} /> */}
                {/* <Row k="Desv.Pad (ms)" v={finalSessionData.sd ?? '—'} /> */}
                <Text style={[styles.sectionTitle,{ marginTop:12 }]}>Top 5 Hoje</Text>
                {leaderboard.slice(0,5).map(r=>(
                  <View
                    key={r.user_id}
                    style={[
                      styles.resRow,
                      r.user_id===userId && { backgroundColor:'rgba(0,211,170,0.08)', borderRadius:8, paddingHorizontal:6 }
                    ]}
                  >
                    <Text style={[styles.resK,{ width:42, fontWeight:'800' }]}>
                      {MEDAL_EMOJI[r.rank] || `${r.rank}º`}
                    </Text>
                    <Text style={[styles.resV,{ flex:1 }]} numberOfLines={1}>{r.user_name || 'Jogador'}</Text>
                    <Text style={[styles.resK,{ color:'#ffd166', fontWeight:'800', width:60, textAlign:'right' }]}>{r.score}</Text>
                    <Text style={[styles.resK,{ width:54, textAlign:'right', color:'#b2c7d3' }]}>
                      {r.accuracy!=null ? Math.round(r.accuracy*100)+'%' : '--'}
                    </Text>
                  </View>
                ))}
                <Text style={[styles.sectionTitle,{ marginTop:12 }]}>Suas Medalhas</Text>
                <View style={styles.medalRowInline}>
                  <Text style={styles.medalTag}>🥇 {medals.gold}</Text>
                  <Text style={styles.medalTag}>🥈 {medals.silver}</Text>
                  <Text style={styles.medalTag}>🥉 {medals.bronze}</Text>
                </View>
                <Text style={[styles.resHint,{ marginTop:8 }]}>Medalhas são consolidadas após o fim do dia.</Text>
                <Text style={[styles.sectionTitle,{ marginTop:14 }]}>Histórico Geral</Text>
                <Row k="Tentativas" v={history.attempts} />
                <Row k="Sucessos" v={history.successes} />
                <Row k="Taxa" v={history.attempts? Math.round((history.successes/history.attempts)*100)+'%':'0%'} />
                <View style={styles.resultsActions}>
                  <TouchableOpacity style={[styles.resBtn, styles.resBtnPrimary]} onPress={()=>{ setShowResults(false); setShowIntro(true); }}>
                    <Feather name="refresh-ccw" size={16} color="#0a0f12" />
                    <Text style={styles.resBtnTxtPrimary}>Jogar de novo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={()=>setShowResults(false)}>
                    <Text style={styles.resBtnTxtGhost}>Fechar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Modal>

        {/* Ranking */}
        <Modal visible={showRanking} transparent animationType="fade" onRequestClose={()=>setShowRanking(false)}>
          <View style={styles.modalWrap}>
            <View style={[styles.resultsCard,{ maxHeight:'86%' }]}>
              <Text style={styles.resultsTitle}>🏆 Ranking Diário</Text>
              <Text style={styles.sectionTitle}>Top 5</Text>
              {leaderboard.length===0 && <Text style={styles.resText}>Sem tentativas ainda.</Text>}
              {leaderboard.map(r=>(
                <View
                  key={r.user_id}
                  style={[
                    styles.resRow,
                    { alignItems:'center' },
                    r.rank<=3 && { backgroundColor:'rgba(255,255,255,0.04)', borderRadius:8, paddingHorizontal:6 },
                    r.user_id===userId && { borderWidth:1, borderColor:'#00d3aa55', borderRadius:8 }
                  ]}
                >
                  <Text style={[styles.resK,{ width:34, fontSize:18 }]}>{MEDAL_EMOJI[r.rank] || `${r.rank}º`}</Text>
                  <Text style={[styles.resV,{ flex:1, fontSize:13 }]} numberOfLines={1}>{r.user_name||'Jogador'}</Text>
                  <Text style={[styles.resK,{ color:'#ffd166', fontWeight:'800', width:60, textAlign:'right' }]}>{r.score}</Text>
                  <Text style={[styles.resK,{ width:54, textAlign:'right', color:'#b2c7d3' }]}>
                    {r.accuracy!=null ? Math.round(r.accuracy*100)+'%' : '--'}
                  </Text>
                </View>
              ))}
              <Text style={[styles.sectionTitle,{ marginTop:12 }]}>Suas Medalhas</Text>
              <View style={styles.medalRowInline}>
                <Text style={styles.medalTag}>🥇 {medals.gold}</Text>
                <Text style={styles.medalTag}>🥈 {medals.silver}</Text>
                <Text style={styles.medalTag}>🥉 {medals.bronze}</Text>
              </View>
              <View style={[styles.resultsActions,{ justifyContent:'space-between' }]}>
                <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={loadLeaderboard}>
                  <Feather name="refresh-ccw" size={16} color="#fff" />
                  <Text style={styles.resBtnTxtGhost}>Atualizar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resBtn, styles.resBtnPrimary]} onPress={()=>setShowRanking(false)}>
                  <Feather name="x" size={16} color="#0a0f12" />
                  <Text style={styles.resBtnTxtPrimary}>Fechar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Painel debug */}
        {__DEV__ && (
          <View style={{ position:'absolute', bottom:0, right:0, backgroundColor:'#000a', padding:6, borderTopLeftRadius:10 }}>
            <Text style={{ color:'#0fd', fontSize:10 }}>Sp:{debugInfo.spawns} Ck:{debugInfo.clicks}</Text>
            <Text style={{ color:'#0fd', fontSize:10 }}>H:{hits} P:{penalties} M:{misses} S:{currentScore}</Text>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

function Row({ k, v, color }) {
  return (
    <View style={styles.resRow}>
      <Text style={styles.resK}>{k}</Text>
      <Text style={[styles.resV, color && { color }]}>{v}</Text>
    </View>
  );
}

// STYLES
const styles = StyleSheet.create({
  header:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingTop:6, paddingBottom:10 },
  iconBtn:{ padding:6 },
  title:{ color:'#fff', fontSize:20, fontWeight:'800' },
  topBar:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:16, paddingBottom:6 },
  topTxt:{ color:'#b2c7d3', fontSize:11 },
  ruleCard:{ marginHorizontal:16, padding:14, borderRadius:16, backgroundColor:'rgba(255,255,255,0.06)', borderWidth:1, borderColor:'rgba(255,255,255,0.12)', marginBottom:4 },
  ruleTitle:{ color:'#ffd166', fontWeight:'800', fontSize:14, marginBottom:4 },
  ruleText:{ color:'#fff', fontSize:14, fontWeight:'600' },
  ruleHint:{ color:'#b2c7d3', fontSize:11, marginTop:8, lineHeight:16 },
  ruleLoading:{ color:'#fff', fontSize:13, fontWeight:'600' },
  ruleError:{ color:'#ff6b6b', fontSize:13, fontWeight:'700' },
  colorsRow:{ flexDirection:'row', alignItems:'center', gap:8, marginTop:10 },
  colorDot:{ width:24, height:24, borderRadius:12, borderWidth:2, borderColor:'#ffffff55' },
  avoidTxt:{ color:'#ff8e8e', fontSize:11, fontWeight:'700' },
  board:{ flex:1, marginHorizontal:16, marginTop:4, borderRadius:20, backgroundColor:'rgba(255,255,255,0.08)', borderWidth:1, borderColor:'rgba(255,255,255,0.12)', overflow:'hidden', position:'relative' },
  target:{ position:'absolute', borderWidth:2 },
  hitArea:{ flex:1, borderRadius:999 },
  hudRow:{ flexDirection:'row', flexWrap:'wrap', gap:10, justifyContent:'space-between', paddingHorizontal:16, paddingBottom:6 },
  hudItem:{ color:'#ffd166', fontSize:12, fontWeight:'700' },
  controlsRow:{ flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:6, paddingBottom:12 },
  ctrlBtn:{ flexDirection:'row', alignItems:'center', paddingVertical:8, paddingHorizontal:14, borderRadius:18, marginRight:10 },
  ctrlTxt:{ marginLeft:8, fontWeight:'800', fontSize:13, color:'#0a0f12' },
  btnStart:{ backgroundColor:'#00d3aa' },
  btnPause:{ backgroundColor:'#ffd166' },
  btnResume:{ backgroundColor:'#00d3aa' },
  btnStop:{ backgroundColor:'#ff6b6b' },
  countdownOverlay:{ ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', backgroundColor:'rgba(0,0,0,0.25)' },
  countdownText:{ color:'#fff', fontSize:64, fontWeight:'800' },
  pauseOverlay:{ ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', backgroundColor:'rgba(0,0,0,0.35)' },
  pauseTxt:{ color:'#fff', fontSize:22, fontWeight:'800', marginTop:8 },
  introOverlay:{ position:'absolute', left:0,right:0,top:0,bottom:0, backgroundColor:'rgba(0,0,0,0.55)', alignItems:'center', justifyContent:'center', zIndex:20 },
  introCard:{ width:'88%', backgroundColor:'rgba(20,27,38,0.97)', borderRadius:24, borderWidth:1, borderColor:'rgba(255,255,255,0.08)', padding:20 },
  introTitle:{ color:'#ffd166', fontSize:20, fontWeight:'800', marginLeft:10 },
  introText:{ color:'#d1e8ff', fontSize:14, lineHeight:20, marginBottom:12, textAlign:'center' },
  introSection:{ color:'#00d3aa', fontSize:13, fontWeight:'800', marginTop:4, marginBottom:4 },
  introList:{ color:'#b2c7d3', fontSize:12, lineHeight:18, textAlign:'center' },
  ruleHighlight:{ color:'#fff', fontSize:14, fontWeight:'700', marginTop:4, textAlign:'center' },
  playBtn:{ flexDirection:'row', alignItems:'center', justifyContent:'center', backgroundColor:'#00d3aa', paddingVertical:12, borderRadius:20, marginTop:14 },
  playBtnTxt:{ color:'#0a0f12', fontWeight:'900', marginLeft:8, fontSize:15 },
  secondaryBtn:{ marginTop:8, alignItems:'center', paddingVertical:8, borderRadius:14, backgroundColor:'#ffffff10' },
  secondaryBtnTxt:{ color:'#fff', fontWeight:'700', fontSize:12 },
  resultsTitle:{ color:'#fff', fontSize:22, fontWeight:'900', textAlign:'center', marginBottom:4 },
  resSubtitle:{ color:'#ffd166', fontSize:14, fontWeight:'700', textAlign:'center', marginBottom:4 },
  resCongrats:{ color:'#b2c7d3', fontSize:12, textAlign:'center', lineHeight:18, marginBottom:10 },
  medalRowInline:{ flexDirection:'row', justifyContent:'space-around', marginTop:4 },
  medalTag:{ color:'#fff', backgroundColor:'rgba(255,255,255,0.08)', paddingHorizontal:10, paddingVertical:6, borderRadius:14, fontSize:12, fontWeight:'700' },
  resHint:{ color:'#8095a3', fontSize:11, textAlign:'center' },
  modalWrap:{ flex:1, backgroundColor:'rgba(0,0,0,0.55)', alignItems:'center', justifyContent:'center' },
  resultsCard:{ width:'90%', backgroundColor:'#101828', borderRadius:20, padding:20, borderWidth:1, borderColor:'rgba(255,255,255,0.08)' },
  sectionTitle:{ color:'#ffd166', fontWeight:'800', fontSize:13, marginTop:14, marginBottom:6 },
  resRow:{ flexDirection:'row', justifyContent:'space-between', paddingVertical:3 },
  resK:{ color:'#b2c7d3', fontSize:12 },
  resV:{ color:'#fff', fontSize:14, fontWeight:'700' },
  resText:{ color:'#fff', fontSize:13, fontWeight:'600' },
  resultsActions:{ flexDirection:'row', justifyContent:'flex-end', flexWrap:'wrap', gap:10, marginTop:14 },
  resBtn:{ flexDirection:'row', alignItems:'center', paddingVertical:10, paddingHorizontal:14, borderRadius:14 },
  resBtnPrimary:{ backgroundColor:'#00d3aa' },
  resBtnGhost:{ backgroundColor:'#ffffff10' },
  resBtnTxtPrimary:{ color:'#0a0f12', fontWeight:'800', marginLeft:8 },
  resBtnTxtGhost:{ color:'#fff', fontWeight:'700', marginLeft:8 }
});

// normalizeRule
function normalizeRule(raw) {
  if (!raw) return null;
  if (raw.rule_type) return raw;
  if (raw.mode && raw.config) {
    const { mode, config } = raw;

    const commonTiming = {
      spawnMin: config.spawn_min ?? null,
      spawnMax: config.spawn_max ?? null,
      ttl:      config.ttl_ms    ?? null,
      concurrent: config.concurrent ?? null,
      pace_variant: config.pace_variant || null
    };

    if (mode === 'max_targets_time') {
      return {
        original: raw,
        mode,
        rule_type: 'max_targets_time',
        params: {
          seconds: config.time_limit || 30,
          ...commonTiming
        }
      };
    }
    if (mode === 'click_only') {
      const seconds = config.timed ? (config.time_limit || 60) : (config.time_limit || 60);
      return {
        original: raw,
        mode,
        rule_type: 'apenas_cor',
        params: {
          seconds,
          allowedColors: config.allowedColors || [],
          forbiddenColors: config.forbiddenColors || [],
          timed: !!config.timed,
          errors_limit: config.errors_limit || 10,
          ...commonTiming
        }
      };
    }
    if (mode === 'avoid_colors') {
      const seconds = config.timed ? (config.time_limit || 60) : (config.time_limit || 60);
      return {
        original: raw,
        mode,
        rule_type: 'evitar_cor',
        params: {
          seconds,
          allowedColors: config.allowedColors || [],
          forbiddenColors: config.forbiddenColors || [],
          timed: !!config.timed,
          errors_limit: config.errors_limit || 10,
          ...commonTiming
        }
      };
    }
  }
  return raw;
}

