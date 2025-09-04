import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, Dimensions, Animated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { Confetti } from '../../components/Confetti';
import Slider from '@react-native-community/slider';
import { supabase } from '../../supabaseClient';
import DesenhoSimbolo from './DesenhoSimbolo';
import { getN2Pool } from '../dados/simbolosSequenciasNivel2';
// >>> GATING (novos)
import { usePlano } from '../../planoContext';        // ajuste caminho se diferente
import { tentarUsar } from '../../core/gatingLocal';  // ajuste caminho se diferente
import { usePaywall } from '../../paywallContext';
import { iniciarComGating } from '../../gating';

// Universo de símbolos suportados pelo DesenhoSimbolo
const ALL_SYMBOLS = [
  'plus','circle','square','ell','angle','tee','wave','circleX','arrow','arc','uArc','zigzag','perp',
  'diamond','triangle','triangleDown','triangleLeft','triangleRight','pentagon','hexagon','star',
  'cross','equal','notEqual','hash','chevronUp','chevronDown','chevronLeft','chevronRight',
  'bracketLeft','bracketRight','bolt','heart','moon','infinity','hourglass','bowtie','trapezoid','ellipse'
];

// Embaralhador simples
const shuffleLocal = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Sons (coloque os arquivos em ../../assets/vitoria.mp3 e ../../assets/derrota.mp3)
const USE_SOUNDS = true;

// Durações por nível (ms de memorização)
const LEVELS = { facil: 9000, medio: 9000, dificil: 9000 };
const LEVEL_ORDER = ['facil', 'medio', 'dificil'];
const PASS_THRESHOLD = 0.7;

const fmtMs = (v) => (v == null ? '—' : `${v} ms`);

const computeStats = (arr) => {
  if (!arr?.length) return { count: 0, avg: null, med: null, sd: null, best: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / arr.length);
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const mean = sum / arr.length;
  const sd = Math.round(Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length));
  const best = Math.min(...arr);
  return { count: arr.length, avg, med, sd, best };
};

// Sons de fim
function useEndSounds() {
  if (!USE_SOUNDS) return { playVictory: () => {}, playDefeat: () => {}, soundsLoaded: false };
  const soundsRef = useRef({ victory: null, defeat: null });
  useEffect(() => {
    let mounted = true;
    (async () => {
      try { await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false, shouldDuckAndroid: true }); } catch {}
      try {
        const victorySrc = require('../../assets/vitoria.mp3');
        const defeatSrc = require('../../assets/derrota.mp3');
        const victory = new Audio.Sound(); const defeat = new Audio.Sound();
        await victory.loadAsync(victorySrc, { volume: 1.0, shouldPlay: false });
        await defeat.loadAsync(defeatSrc, { volume: 1.0, shouldPlay: false });
        if (mounted) { soundsRef.current = { victory, defeat }; }
      } catch (e) {
        console.log('Erro ao carregar sons:', e);
      }
    })();
    return () => { Object.values(soundsRef.current).forEach(s => s && s.unloadAsync()); };
  }, []);
  const play = async (k) => {
    const s = soundsRef.current[k];
    if (!s) return;
    try { await s.stopAsync(); await s.setPositionAsync(0); await s.playAsync(); } catch {}
  };
  return { playVictory: () => play('victory'), playDefeat: () => play('defeat') };
}

// Salva recorde por nível no Supabase (insert/update condicional por user_name+level)
const saveProcurarRecord = async (sessionRow) => {
  try {
    const payload = {
      user_name: (sessionRow.player || 'Convidado').slice(0, 80),
      level: sessionRow.level,                    // 'facil' | 'medio' | 'dificil'
      percent: sessionRow.percent ?? null,        // int
      time_total_s: sessionRow.time_total_s ?? null,
      avg_time_s: sessionRow.avg_time_s ?? null,  // numeric(6,3)
      score: sessionRow.score ?? null,
      total_answered: sessionRow.total_answered ?? null,
    };

    const { data: existing, error: selErr, status } = await supabase
      .from('procurar_simbolos_results')
      .select('id, percent, time_total_s, avg_time_s')
      .eq('user_name', payload.user_name)
      .eq('level', payload.level)
      .maybeSingle();

    if (selErr && status !== 406) {
      console.log('[Supabase][procurar_simbolos_results] select error:', {
        status,
        message: selErr.message,
        details: selErr.details,
        hint: selErr.hint,
        code: selErr.code,
      });
      return false;
    }

    if (!existing) {
      const { data, error } = await supabase
        .from('procurar_simbolos_results')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        console.log('[Supabase][procurar_simbolos_results] insert error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return false;
      }
      console.log('[Supabase][procurar_simbolos_results] insert ok id=', data?.id);
      return true;
    }

    // Critério de melhor: maior percent; empate => menor tempo total; novo empate => menor tempo médio
    const better =
      (payload.percent ?? -1) > (existing.percent ?? -1) ||
      ((payload.percent ?? -1) === (existing.percent ?? -1) &&
        (payload.time_total_s ?? 999999) < (existing.time_total_s ?? 999999)) ||
      ((payload.percent ?? -1) === (existing.percent ?? -1) &&
        (payload.time_total_s ?? 999999) === (existing.time_total_s ?? 999999) &&
        (payload.avg_time_s ?? 9999) < (existing.avg_time_s ?? 9999));

    if (!better) {
      console.log('[Supabase][procurar_simbolos_results] keep existing; new is not better');
      return true;
    }

    const { error: updErr } = await supabase
      .from('procurar_simbolos_results')
      .update(payload)
      .eq('id', existing.id);
    if (updErr) {
      console.log('[Supabase][procurar_simbolos_results] update error:', {
        message: updErr.message,
        details: updErr.details,
        hint: updErr.hint,
        code: updErr.code,
      });
      return false;
    }
    console.log('[Supabase][procurar_simbolos_results] update ok id=', existing.id);
    return true;
  } catch (e) {
    console.log('[Supabase][procurar_simbolos_results] exception:', e?.message || e);
    return false;
  }
};

async function fetchDisplayName() {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return 'Convidado';
    const meta = u.user_metadata || {};
    const { data: p } = await supabase
      .from('profiles')
      .select('nickname,name')
      .eq('id', u.id)
      .maybeSingle();
    return (
      (p?.nickname || '').trim() ||
      (p?.name || '').trim() ||
      (meta.nickname || '').trim() ||
      (meta.full_name || meta.name || '').trim() ||
      (u.email ? u.email.split('@')[0] : '') ||
      'Convidado'
    ).slice(0, 80);
  } catch {
    return 'Convidado';
  }
}

// NOVA função: sempre insere (histórico)
async function insertProcurarRecord(row) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    const user_name = await fetchDisplayName();
    const payload = {
      user_id: uid,
      user_name,
      level: row.level,
      percent: row.percent ?? null,
      time_total_s: row.time_total_s ?? null,
      avg_time_s: row.avg_time_s ?? null,
      score: row.score ?? null,
      total_answered: row.total_answered ?? null,
    };
    console.log('[ProcurarSímbolos] insert payload', payload);
    const { error } = await supabase
      .from('procurar_simbolos_results')
      .insert(payload);
    if (error) {
      console.log('[ProcurarSímbolos] insert ERROR', error);
      return false;
    }
    return true;
  } catch (e) {
    console.log('[ProcurarSímbolos] insert exception', e?.message || e);
    return false;
  }
}

export default function ProcurarSimbolos({ navigation }) {
  // Configs
  const [config, setConfig] = useState({ level: 'facil', series: 20 /*, name removido */ });
  const [showSettings, setShowSettings] = useState(false);
  const [displayName, setDisplayName] = useState(null);
  // Fluxo
  const [fase, setFase] = useState('intro');
  const [idx, setIdx] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [memLeft, setMemLeft] = useState(null);
  const [currentRt, setCurrentRt] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  // Dados sessão
  const dataRef = useRef([]);
  const questionDeckRef = useRef([]);
  const startChoicesRef = useRef(0);
  const [rts, setRts] = useState([]);
  const [hits, setHits] = useState(0);
  const [errors, setErrors] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(config.level);
  const currentLevelRef = useRef(currentLevel);
  useEffect(() => { currentLevelRef.current = currentLevel; }, [currentLevel]);

  // Seleção
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [markedNo, setMarkedNo] = useState(false);

  // Perfil e Recordes (locais)
  const [bestUser, setBestUser] = useState({ avg: null, best: null, count: 0, name: '' });
  const [records, setRecords] = useState({ bestSingleMs: null, bestSingleName: '', bestAvgMs: null, bestAvgName: '' });
  const [lastGameStats, setLastGameStats] = useState(null);

  // UI
  const entryAnim = useRef(new Animated.Value(0)).current;
  const { width } = Dimensions.get('window');
  const { playVictory, playDefeat } = useEndSounds();

  const item = dataRef.current[idx];
  const total = dataRef.current.length;

  // Timers
  const memTimerRef = useRef(null);
  const memTickRef = useRef(null);
  const countdownTimeoutRef = useRef(null);
  const rtTickRef = useRef(null);

  const itemShuffled = useMemo(() => {
    if (!item) return null;
    const mapped = item.choices.map((c, i) => ({ c, i }));
    mapped.sort(() => Math.random() - 0.5);
    const choices = mapped.map(m => m.c);
    const ansSet = new Set(item.answerIndices || []);
    const answerIndices = mapped.reduce((acc, m, newIdx) => (ansSet.has(m.i) ? (acc.push(newIdx), acc) : acc), []);
    return { ...item, choices, answerIndices };
  }, [item, idx]);

  // Alvos exibidos na memorização (com distratores por nível)
  const displayTargets = useMemo(() => {
    if (!item) return [];
    const base = (item.targets || []).slice();
    const choicesNow = (itemShuffled || item)?.choices || [];
    const choicesSet = new Set(choicesNow);
    const pool = ALL_SYMBOLS.filter(s => !choicesSet.has(s) && !base.includes(s));
    const extraCount = currentLevel === 'medio' ? 1 : (currentLevel === 'dificil' ? 2 : 0);
    const picks = shuffleLocal(pool).slice(0, extraCount);
    let arr = base.slice();
    picks.forEach(p => {
      const pos = Math.floor(Math.random() * (arr.length + 1));
      arr.splice(pos, 0, p);
    });
    return arr;
  }, [item, itemShuffled, currentLevel]);

  // Carregar dados salvos
  useEffect(() => {
    Animated.timing(entryAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    (async () => {
      try {
        const c = await AsyncStorage.getItem('ps:config'); if (c) setConfig(JSON.parse(c));
        const bu = await AsyncStorage.getItem('ps:bestUser'); if (bu) setBestUser(JSON.parse(bu));
        const rc = await AsyncStorage.getItem('ps:records'); if (rc) setRecords(JSON.parse(rc));
        const lgs = await AsyncStorage.getItem('ps:lastGame'); if (lgs) setLastGameStats(JSON.parse(lgs));
      } catch {}
      try {
        const dn = await fetchDisplayName();
        setDisplayName(dn);
      } catch {}
    })();
    return () => clearAllTimers();
  }, []);

  // Salvar config
  const saveConfig = async (newConfig) => {
    const fixed = { ...newConfig, series: Number(newConfig.series) || 20 };
    setConfig(fixed);
    if (fixed.level && fixed.level !== currentLevel) setCurrentLevel(fixed.level);
    try { await AsyncStorage.setItem('ps:config', JSON.stringify(fixed)); } catch {}
  };

  // Ajuste: recebe seriesOverride (snapshot) para não depender de possível atraso de setState
  const resetRound = (isNewLevel = false, seriesOverride = null) => {
    setIdx(0);
    setRts([]);
    setHits(0);
    setErrors(0);
    setSelectedIndices([]);
    setMarkedNo(false);

    let seriesCount = seriesOverride != null ? Number(seriesOverride) : Number(config.series);
    if (!seriesCount || seriesCount < 1) seriesCount = 20;

    // Gera pool e garante comprimento suficiente
    const pool = getN2Pool(180);
    if (pool.length < seriesCount) seriesCount = pool.length;

    const shuffled = shuffleLocal(pool).slice(0, seriesCount);
    questionDeckRef.current = shuffled.slice(); // cópia completa
    dataRef.current = shuffled;                 // rounds desta sessão

    // debug (remova se quiser)
    console.log('[PS] series escolhidas=', seriesCount, 'pool=', pool.length);

    if (!isNewLevel) setCurrentLevel(lvl => lvl || config.level);
  };

  // startCountdown captura snapshot de séries
  const startCountdown = async () => {
    setShowSettings(false);
    const seriesSnapshot = Number(config.series) || 20;
    resetRound(true, seriesSnapshot);
    clearAllTimers();
    setFase('countdown');
    setCountdown(3);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const tick = (n) => {
      setCountdown(n);
      if (n === 0) { setCountdown(null); countdownTimeoutRef.current = null; startMemorize(); return; }
      countdownTimeoutRef.current = setTimeout(() => tick(n - 1), 1000);
    };
    tick(3);
  };

  const startMemorize = () => {
    clearAllTimers();
    setFase('memorize');
    setSelectedIndices([]);
    setMarkedNo(false);
    const lvl = currentLevelRef.current;
    const dur = LEVELS[lvl] ?? LEVELS.medio;
    const start = Date.now();
    setMemLeft(dur);
    memTickRef.current = setInterval(() => setMemLeft(Math.max(0, dur - (Date.now() - start))), 100);
    memTimerRef.current = setTimeout(() => { clearInterval(memTickRef.current); setMemLeft(0); startChoices(); }, dur);
  };

  const startChoices = async () => {
    clearAllTimers();
    setFase('choices');
    setSelectedIndices([]);
    setMarkedNo(false);
    startChoicesRef.current = Date.now();
    rtTickRef.current = setInterval(() => setCurrentRt(Date.now() - startChoicesRef.current), 50);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const clearAllTimers = () => {
    if (memTimerRef.current) clearTimeout(memTimerRef.current);
    if (memTickRef.current) clearInterval(memTickRef.current);
    if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
    if (rtTickRef.current) clearInterval(rtTickRef.current);
    memTimerRef.current = memTickRef.current = countdownTimeoutRef.current = rtTickRef.current = null;
  };

  const submitAnswer = async () => {
    if (fase !== 'choices') return;
    clearInterval(rtTickRef.current);
    rtTickRef.current = null;
    const rt = Date.now() - startChoicesRef.current;
    const correctIndices = (itemShuffled || item).answerIndices || [];
    const targetCount = correctIndices.length;
    let ok = false;
    if (targetCount === 0) {
      ok = markedNo && selectedIndices.length === 0;
    } else {
      if (markedNo || selectedIndices.length !== targetCount) ok = false;
      else {
        const s1 = new Set(selectedIndices); const s2 = new Set(correctIndices);
        ok = selectedIndices.every(i => s2.has(i)) && correctIndices.every(i => s1.has(i));
      }
    }
    setRts(arr => [...arr, rt]);
    if (ok) setHits(h => h + 1); else setErrors(e => e + 1);
    await Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy);
    const next = idx + 1;
    if (next >= total) finishSession();
    else { setIdx(next); startMemorize(); }
  };

  const finishSession = async () => {
    clearAllTimers();
    setFase('done');
    const s = computeStats(rts);
    const totalAnswers = hits + errors;
    const percentF = totalAnswers > 0 ? hits / totalAnswers : 0;
    const sessionStats = { ...s, hits, errors, percent: Math.round(percentF * 100), level: currentLevel };
    setLastGameStats(sessionStats);
    try { await AsyncStorage.setItem('ps:lastGame', JSON.stringify(sessionStats)); } catch {}
    if (percentF >= PASS_THRESHOLD) playVictory(); else playDefeat();

    const betterAvg = bestUser.avg == null || (s.avg != null && s.avg < bestUser.avg);
    const betterSingle = bestUser.best == null || (s.best != null && s.best < bestUser.best);
    const bu = {
      avg: betterAvg ? s.avg : bestUser.avg,
      best: betterSingle ? s.best : bestUser.best,
      count: s.count,
      name: displayName || ''
    };
    if (betterAvg || betterSingle) { setBestUser(bu); try { await AsyncStorage.setItem('ps:bestUser', JSON.stringify(bu)); } catch {} }
    let rc = { ...records }; let changed = false;
    if (s.best != null && (rc.bestSingleMs == null || s.best < rc.bestSingleMs)) { rc.bestSingleMs = s.best; rc.bestSingleName = displayName || ''; changed = true; }
    if (s.avg != null && (rc.bestAvgMs == null || s.avg < rc.bestAvgMs)) { rc.bestAvgMs = s.avg; rc.bestAvgName = displayName || ''; changed = true; }
    if (changed) { setRecords(rc); try { await AsyncStorage.setItem('ps:records', JSON.stringify(rc)); } catch {} }

    // --- Envio ao Supabase e snapshot local para Records ---
    const totalMs = rts.reduce((a, b) => a + b, 0);
    const time_total_s = Math.round(totalMs / 1000);
    const avg_time_s = rts.length ? Number((totalMs / rts.length / 1000).toFixed(3)) : null;
    const dbRow = {
      player: displayName || null, // usa nome do Perfil; se não houver, envia null
      level: currentLevel,
      percent: sessionStats.percent,
      time_total_s,
      avg_time_s,
      score: hits,
      total_answered: totalAnswers,
    };

    const localForRecords = {
      user_name: dbRow.player || '', // apenas para histórico local
      level: dbRow.level,
      percent: dbRow.percent,
      time_total_s: dbRow.time_total_s,
      avg_time_s: dbRow.avg_time_s,
      score: dbRow.score,
      total_answered: dbRow.total_answered,
      created_at: new Date().toISOString(),
    };
    try { await AsyncStorage.setItem('procurar_simbolos:last', JSON.stringify(localForRecords)); } catch {}

    // Envia ao Supabase (apenas se melhor por nível)
    try {
      const ok = await insertProcurarRecord(dbRow);
      console.log('[ProcurarSímbolos] envio Supabase:', ok ? 'ok' : 'falhou');
    } catch (e) {
      console.log('[ProcurarSímbolos] erro ao inserir:', e?.message || e);
    }
  };

  const passed = lastGameStats ? lastGameStats.percent / 100 >= PASS_THRESHOLD : false;
  const hasNextLevel = LEVEL_ORDER.indexOf(currentLevel) < LEVEL_ORDER.length - 1;

  // (5) Wrappers ajustados para passar no gating
  const goNextLevel = () => {
    if (startingGate) return;
    const idxL = LEVEL_ORDER.indexOf(currentLevel);
    if (idxL < LEVEL_ORDER.length - 1) {
      const nextLevel = LEVEL_ORDER[idxL + 1];
      setCurrentLevel(nextLevel);
      setConfig(c => ({ ...c, level: nextLevel }));
      setStartingGate(true);
      iniciarComGating('procurar-simbolos', () => startCountdown())
        .finally(() => setStartingGate(false));
    }
  };
  const replaySameLevel = () => {
    if (startingGate) return;
    setStartingGate(true);
    iniciarComGating('procurar-simbolos', () => startCountdown())
      .finally(() => setStartingGate(false));
  };

  // >>> GATING hooks (ADICIONAR)
  const [startingGate, setStartingGate] = useState(false);      // trava enquanto checa limite
  const { plano } = usePlano();                                 // plano atual (free, premium, etc)
  const { open: openPaywall } = usePaywall();                   // função que abre a paywall/modal

  const insets = useSafeAreaInsets();
  // Removido padding adicional: SafeAreaView já aplica o inset do notch
  const headerTop = 0;

  const onStart = () => {
    if (startingGate) return;
    setStartingGate(true);
    iniciarComGating('procurar-simbolos', () => startCountdown())
      .finally(() => setStartingGate(false));
  };

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        {fase !== 'intro' && fase !== 'done' && (
          <View
            style={[styles.header, { paddingTop: headerTop }]}
          >
            <TouchableOpacity onPress={() => { clearAllTimers(); navigation.goBack(); }} style={styles.iconBtn}>
              <Feather name="arrow-left" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Procurar Símbolos</Text>
            <View style={{ width: 34 }} />
          </View>
        )}

        {(fase === 'memorize' || fase === 'choices') && (
          <View style={styles.roundBar}>
            <Text style={styles.roundText}>
              Rodada {Math.min(idx + 1, (total || config.series))} / {total || config.series}
            </Text>
          </View>
        )}

        {fase === 'intro' && (
          <View style={styles.introOverlay} pointerEvents="box-none">
            <View style={[styles.introBackWrap, { top: headerTop + 4 }]}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
                <Feather name="arrow-left" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <Animated.View style={[styles.introCard, { transform: [{ scale: entryAnim }] }]} pointerEvents="auto">
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, alignSelf: 'center' }}>
                <Feather name="zap" size={22} color="#ffd166" />
                <Text style={styles.introTitle}>Procurar Símbolos</Text>
              </View>

              <Text style={styles.introText}>
                Memorize os símbolos-alvo. Depois, encontre-os na grade e marque-os. Se nenhum aparecer, marque “Não”.
              </Text>
              <Text style={styles.cognitiveText}>
                Este exercício treina a memória de trabalho visual, atenção seletiva e velocidade de processamento.
              </Text>

              {/* Seletor de nível */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                {LEVEL_ORDER.map(l => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.chip, currentLevel === l && styles.chipSelected]}
                    onPress={() => { setCurrentLevel(l); setConfig(c => ({ ...c, level: l })); }}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.chipTxt, currentLevel === l && { color: '#000' }]}>
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.introBtn, startingGate && { opacity: 0.5 }]}
                onPress={onStart}
                disabled={startingGate}
                activeOpacity={0.9}
              >
                <Feather name="play-circle" size={22} color="#0a0f12" />
                <Text style={styles.introBtnTxt}>{startingGate ? '...' : 'Começar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGhost, { alignSelf: 'center', marginTop: 8 }]} onPress={() => setShowSettings(true)}>
                <Feather name="settings" size={16} color="#fff" />
                <Text style={[styles.btnGhostTxt, { marginLeft: 8 }]}>Configurações</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        {fase === 'countdown' && (
          <View style={styles.center}>
            <Text style={[styles.title, { fontSize: 42 }]}>{countdown ?? 0}</Text>
            <Text style={styles.help}>Prepare-se...</Text>
          </View>
        )}

        {fase === 'memorize' && (
          <View style={styles.center}>
            <View style={styles.cardGlass}>
              <Text style={styles.section}>Memorize os alvos</Text>
              <View style={styles.targetsRow}>
                {displayTargets.map((t, k) => (
                  <View key={k} style={styles.targetBox}>
                    <DesenhoSimbolo type={t} size={76} />
                  </View>
                ))}
              </View>
              <Text style={styles.help}>Tempo restante: {(Math.ceil((memLeft ?? 0) / 100) / 10).toFixed(1)}s</Text>
            </View>
          </View>
        )}

        {fase === 'choices' && (
          <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: 'center' }}>
            <View style={[styles.cardGlass, { marginTop: 8, paddingBottom: 8 }]}>
              <Text style={styles.section}>Encontre os alvos</Text>
              <FlatList
                data={(itemShuffled || item).choices}
                keyExtractor={(_, i) => `c-${i}`}
                numColumns={3}
                contentContainerStyle={{ paddingVertical: 8 }}
                renderItem={({ item: code, index }) => {
                  const selected = selectedIndices.includes(index);
                  return (
                    <TouchableOpacity
                      style={[styles.cell, selected && styles.cellSelected]}
                      onPress={() => {
                        setMarkedNo(false);
                        setSelectedIndices(p => p.includes(index) ? p.filter(i => i !== index) : [...p, index]);
                      }}
                      activeOpacity={0.88}
                    >
                      <DesenhoSimbolo type={code} />
                    </TouchableOpacity>
                  );
                }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost, markedNo && styles.btnNoSelected]}
                  onPress={() => setMarkedNo(v => { const nv = !v; if (nv) setSelectedIndices([]); return nv; })}
                  activeOpacity={0.9}
                >
                  <Text style={styles.btnGhostTxt}>Não</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, !((markedNo) || (selectedIndices.length > 0)) && { opacity: 0.5 }]}
                  onPress={submitAnswer}
                  disabled={!((markedNo) || (selectedIndices.length > 0))}
                  activeOpacity={0.92}
                >
                  <Feather name="check-circle" size={18} color="#0a0f12" /><Text style={styles.btnPrimaryTxt}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.timerText}>Tempo: {(currentRt / 1000).toFixed(2)}s</Text>
          </View>
        )}

        <Modal visible={fase === 'done'} transparent animationType="fade">
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              {showConfetti && (
                <Confetti count={140} duration={5000} />
              )}
              <Text style={styles.resultsTitle}>{passed ? 'Vitória!' : 'Tente de Novo'}</Text>
              <Text style={styles.resultsSubtitle}>
                {passed
                  ? `Você passou do nível ${currentLevel} com ${lastGameStats?.percent}% de acertos!`
                  : `Você precisava de ${PASS_THRESHOLD * 100}% de acertos para avançar.`}
              </Text>

              {lastGameStats && (
                <>
                  <View style={styles.resultsGrid}>
                    <View style={styles.resItem}><Feather name="clock" size={18} color="#ffd166" /><Text style={styles.resVal}>{fmtMs(lastGameStats.avg)}</Text><Text style={styles.resKey}>Média</Text></View>
                    <View style={styles.resItem}><Feather name="zap" size={18} color="#00d3aa" /><Text style={styles.resVal}>{fmtMs(lastGameStats.best)}</Text><Text style={styles.resKey}>Melhor</Text></View>
                    <View style={styles.resItem}><Feather name="percent" size={18} color="#9fd3ff" /><Text style={styles.resVal}>{lastGameStats.percent}%</Text><Text style={styles.resKey}>Precisão</Text></View>
                  </View>
                </>
              )}

              <View style={styles.actionsRow}>
                {passed && hasNextLevel ? (
                  <>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnPrimary, startingGate && { opacity: 0.55 }]}
                      onPress={goNextLevel}
                      disabled={startingGate}
                    >
                      <Feather name="arrow-right-circle" size={18} color="#0a0f12" />
                      <Text style={styles.btnPrimaryTxt}>Avançar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnGhost, startingGate && { opacity: 0.55 }]}
                      onPress={replaySameLevel}
                      disabled={startingGate}
                    >
                      <Text style={styles.btnGhostTxt}>Refazer</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnPrimary, startingGate && { opacity: 0.55 }]}
                      onPress={replaySameLevel}
                      disabled={startingGate}
                    >
                      <Feather name="refresh-ccw" size={18} color="#0a0f12" />
                      <Text style={styles.btnPrimaryTxt}>Tentar novamente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => { setFase('intro'); resetRound(); }}>
                      <Text style={styles.btnGhostTxt}>Menu</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.resultsTitle}>Configurações</Text>

              <Text style={styles.section}>Jogo</Text>
              <View style={styles.row}><Text style={styles.resKey}>Nível Inicial</Text></View>
              <View style={[styles.row, {justifyContent: 'space-around', marginVertical: 8}]}>
                {LEVEL_ORDER.map(l => (
                  <TouchableOpacity key={l} style={[styles.chip, config.level === l && styles.chipSelected]} onPress={() => saveConfig({...config, level: l})}>
                    <Text style={[styles.chipTxt, config.level === l && {color: '#000'}]}>{l.charAt(0).toUpperCase() + l.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.row}><Text style={styles.resKey}>Séries por Partida</Text><Text style={styles.resVal}>{config.series}</Text></View>
              <Slider
                style={{width: '100%', height: 40}}
                minimumValue={5} maximumValue={30} step={1}
                value={config.series}
                onSlidingComplete={(val) => saveConfig({...config, series: Number(val)})}
                minimumTrackTintColor="#00d3aa" maximumTrackTintColor="rgba(255,255,255,0.2)" thumbTintColor="#00d3aa"
              />

              <Text style={styles.section}>Perfil e Recordes</Text>
              {/* removido campo "Seu nome" — agora usa displayName do Perfil */}
              {lastGameStats && <Text style={styles.recLine}>Último Jogo: {lastGameStats.percent}% acertos, média {fmtMs(lastGameStats.avg)}</Text>}
              <Text style={styles.recLine}>Seu Melhor: {fmtMs(bestUser.best)} • Média: {fmtMs(bestUser.avg)}</Text>
              <Text style={styles.recLine}>Recorde App (Média): {fmtMs(records.bestAvgMs)} por {records.bestAvgName || 'N/A'}</Text>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setShowSettings(false)}>
                  <Text style={styles.btnGhostTxt}>Fechar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 6 },
  iconBtn: { padding: 6 },
  title: { color: '#fff', fontWeight: '800', fontSize: 22 },   // << fonte maior
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipTxt: { color: '#d1e8ff', fontSize: 13, fontWeight: '600' },
  chipSelected: { backgroundColor: '#00d3aa', borderColor: '#00d3aa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  cardGlass: { width: '100%', alignSelf: 'center', backgroundColor: 'rgba(8,12,20,0.45)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 16, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  section: { color: '#b2c7d3', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginVertical: 10, alignSelf: 'center' },
  help: { color: '#b2c7d3', marginTop: 4 },
  targetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center', marginBottom: 8 },
  targetBox: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', width: '44%', alignItems: 'center', marginBottom: 8 },
  cell: { width: '31%', aspectRatio: 1, margin: '1.15%', alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  cellSelected: { borderColor: '#00d3aa', backgroundColor: '#00d3aa22' },
  timerText: { color: '#ffd166', textAlign: 'center', fontWeight: '600', fontSize: 14, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 22, marginTop: 12, minWidth: 120 },
  btnPrimary: { backgroundColor: '#00d3aa' },
  btnPrimaryTxt: { color: '#0a0f12', fontWeight: '800', marginLeft: 8 },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnGhostTxt: { color: '#fff', fontWeight: '700' },
  btnNoSelected: { backgroundColor: '#efad0044', borderColor: '#efad00' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', backgroundColor: '#101828', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  resultsTitle: { color: '#fff', fontWeight: '900', fontSize: 22, marginBottom: 4, alignSelf: 'center' },
  resultsSubtitle: { color: '#b2c7d3', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  resultsGrid: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 8 },
  resItem: { alignItems: 'center', width: '33%' },
  resKey: { color: '#b2c7d3', fontSize: 12, marginTop: 2, textAlign: 'center' },
  resVal: { color: '#fff', fontWeight: '900', fontSize: 18, marginTop: 4, textAlign: 'center' },
  recLine: { color: '#d1e8ff', fontSize: 13, marginTop: 4 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
  introOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  introBackWrap: { position: 'absolute', left: 14, zIndex: 2 }, // top agora dinâmico
  introCard: { width: '90%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 },
  introTitle: { color: '#ffd166', fontSize: 20, fontWeight: '800', marginLeft: 8 },
  introText: { color: '#d1e8ff', fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: 'center', marginBottom: 8 },
  cognitiveText: { color: '#b2c7d3', fontSize: 13, fontStyle: 'italic', textAlign: 'center', marginBottom: 16, paddingHorizontal: 10 },
  introBtn: { backgroundColor: '#00d3aa', paddingVertical: 12, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  introBtnTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 16, marginLeft: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 4 },
  input: { marginLeft: 12, paddingVertical: 8, paddingHorizontal: 10, color: '#fff', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 10, flex: 1 },
  confettiLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  roundBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    alignItems: 'center'
  },
  roundText: {
    color: '#9fd3ff',
    fontSize: 13,
    fontWeight: '600'
  },
});