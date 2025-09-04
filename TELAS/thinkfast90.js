import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Modal, TextInput, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'; // <- novo
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
// SUBSTITUA os imports de confetti CANON:
let ConfettiCannon;
try {
  ConfettiCannon = require('react-native-confetti-cannon').default;
} catch {
  ConfettiCannon = () => null;
}

// >>> GATING (novos)
import { usePlano } from '../planoContext';        // fornece o plano atual do usuário
import { tentarUsar } from '../core/gatingLocal';  // função local que checa limites/uso
import { usePaywall } from '../paywallContext';    // abrir paywall quando limite estourar

const rand = (a, b) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Cores PT (para botões/tema) e mapeamento EN (palavra dentro da bolinha)
const PT_COLORS = {
  VERMELHO: '#e74c3c',
  VERDE: '#2ecc71',
  AZUL: '#3498db',
  PRETO: '#111111',
  BRANCO: '#ecf0f1',
};
const EN_TO_PT = { RED: 'VERMELHO', GREEN: 'VERDE', BLUE: 'AZUL', BLACK: 'PRETO', WHITE: 'BRANCO' };
const EN_NORMAL = ['RED', 'GREEN', 'BLUE'];
const EN_HARD = ['RED', 'GREEN', 'BLUE', 'BLACK', 'WHITE'];

// Durações de mensagens na tela (fácil de ajustar)
const MESSAGE_SHOW_MS = 10000; // mentor e banner de bloco
const MENTOR_EVERY_ROUNDS = 15; // ajuste: ex. 4 para a cada 4 rodadas

function hexToRgba(hex, alpha = 0.65) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Nome público do Perfil (profiles ou user_metadata)
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
      p?.nickname ||
      p?.name ||
      meta.nickname ||
      meta.full_name ||
      meta.name ||
      (u.email ? u.email.split('@')[0] : 'Você')
    );
  } catch {
    return 'Você';
  }
}

// Sons fim de rodada
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
      } catch (e) {
        console.log('[Som] falha ao carregar', e);
      }
    })();
    return () => {
      Object.values(soundsRef.current).forEach(s => s && s.unloadAsync());
    };
  }, []);
  const play = async (k) => {
    const s = soundsRef.current[k];
    if (!s) return;
    try { await s.stopAsync(); await s.setPositionAsync(0); await s.playAsync(); } catch {}
  };
  return { playVictory: () => play('victory'), playDefeat: () => play('defeat') };
}

// ADICIONE: helper para salvar a sessão no Supabase
async function saveThinkfast90Result({ displayName, difficulty, stats, percent, hits }) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user_id = auth?.user?.id || null;

    const payload = {
      user_id,
      user_name: (displayName || 'Convidado').slice(0, 80),
      difficulty,                          // 'normal' | 'hard'
      percent: percent ?? null,            // inteiro 0–100
      hits: hits ?? null,                  // acertos
      avg_ms: stats?.avg ?? null,          // média em ms
      best_single_ms: stats?.best ?? null, // melhor em ms
      best_streak_count: null,             // se não calcular, deixar null
      best_streak_time_ms: null,           // idem
      // created_at pode ter default now() no banco
    };

    const { error } = await supabase.from('thinkfast90_results').insert(payload);
    if (error) {
      console.log('[thinkfast90] insert error:', error.message, error.details, error.hint);
      return false;
    }
    return true;
  } catch (e) {
    console.log('[thinkfast90] insert exception:', e?.message || e);
    return false;
  }
}

export default function ThinkFast90({ navigation }) {
  // Sessão/UI
  const [showIntro, setShowIntro] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Pronto. Toque em Iniciar.');
  const [countdown, setCountdown] = useState(null);

  // Dificuldade e botões
  const [difficulty, setDifficulty] = useState('normal'); // 'normal' | 'hard'
  const currentEnWords = difficulty === 'hard' ? EN_HARD : EN_NORMAL;
  const currentPtButtons = (difficulty === 'hard'
    ? ['VERMELHO', 'VERDE', 'AZUL', 'PRETO', 'BRANCO']
    : ['VERMELHO', 'VERDE', 'AZUL']);

  // Tabuleiro
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  const [targets, setTargets] = useState([]); // [{id,x,y,wordEn,fillPt,created,scale}]
  const groupStartRef = useRef(0);
  const groupsDoneRef = useRef(0);

  // Pontos e tempos
  const [times, setTimes] = useState([]); // acertos (ms)
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0); // mantido, mas sem TTL não incrementa
  const [wrongClicks, setWrongClicks] = useState(0);
  const [lastRt, setLastRt] = useState(null);

  // Nome do Perfil (Supabase) e recordes/resultados
  const [displayName, setDisplayName] = useState('Convidado');
  const [bestUser, setBestUser] = useState({ avg: null, best: null, count: 0, name: '' });
  const [records, setRecords] = useState({
    normal: { bestSingleMs: null, bestSingleName: '', bestAvgMs: null, bestAvgName: '' },
    hard:   { bestSingleMs: null, bestSingleName: '', bestAvgMs: null, bestAvgName: '' },
  });
  const [showResults, setShowResults] = useState(false);
  const [lastStats, setLastStats] = useState(null);

  // Feedback UI extra
  const [pressedBtn, setPressedBtn] = useState(null);
  const [blockBanner, setBlockBanner] = useState(null);
  const [mentorMsg, setMentorMsg] = useState(null);
  const [preRts] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef(null);

  // Configurações (TTL/Delay não ficam no modal)
  const [cfg, setCfg] = useState({
    trials: 30,
    size: 95,          // agora fixo (não exposto no modal)
    ballFontSize: 20,
  });
  const [showSettings, setShowSettings] = useState(false);

  // Timers e refs (sem TTL de alvo)
  const spawnRef = useRef(null);
  const entryAnim = useRef(new Animated.Value(0)).current;
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const cfgRef = useRef(cfg);

  const { playVictory, playDefeat } = useEndSounds();

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  useEffect(() => {
    Animated.timing(entryAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    loadPersisted();
    return () => cleanupAllTimers();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem('thinkfast90:cfg', JSON.stringify(cfg)).catch(() => {});
  }, [cfg]);

  useEffect(() => {
    if (targets.length > 0) {
      const tick = () => {
        setElapsedMs(Math.max(0, Date.now() - groupStartRef.current));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setElapsedMs(0);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [targets]);

  const loadPersisted = async () => {
    try {
      // removido perfil local
      const bu = await AsyncStorage.getItem('thinkfast90:bestUser'); if (bu) setBestUser(JSON.parse(bu));
      const rc = await AsyncStorage.getItem('thinkfast90:records'); if (rc) setRecords(prev => ({ ...prev, ...JSON.parse(rc) }));
      const c = await AsyncStorage.getItem('thinkfast90:cfg'); if (c) setCfg(prev => ({ ...prev, ...JSON.parse(c) }));
      const last = await AsyncStorage.getItem('thinkfast90:last'); if (last) setLastStats(JSON.parse(last));
    } catch {}
    // nome do Perfil (Supabase)
    try {
      const dn = await fetchDisplayName();
      setDisplayName(dn);
    } catch {}
  };

  const cleanupAllTimers = () => {
    if (spawnRef.current) clearTimeout(spawnRef.current);
    spawnRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const resetAll = () => {
    cleanupAllTimers();
    setRunning(false);
    setPaused(false);
    setStatusMsg('Pronto. Toque em Iniciar.');
    setTargets([]);
    groupStartRef.current = 0;
    groupsDoneRef.current = 0;
    setTimes([]);
    setHits(0);
    setMisses(0);
    setWrongClicks(0);
    setLastRt(null);
    setCountdown(null);
    setBlockBanner(null);
    setMentorMsg(null);
    setElapsedMs(0);
  };

  const startCountdown = async () => {
    setCountdown(3);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const tick = (n) => {
      setCountdown(n);
      if (n === 0) {
        setCountdown(null);
        setRunning(true); runningRef.current = true;
        setPaused(false); pausedRef.current = false;
        setStatusMsg('Vai!');
        scheduleNextGroup(60);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      setTimeout(() => tick(n - 1), 1000);
    };
    tick(3);
  };

  const start = () => {
    resetAll();
    setShowIntro(false); // fecha o onboarding
    startCountdown();    // inicia direto
  };

  // agenda próximo alvo após um pequeno delay (apenas depois da resposta)
  const scheduleNextGroup = (delay = 300) => {
    if (!runningRef.current || pausedRef.current) return;
    const trials = Number(cfgRef.current.trials) || 0;
    if (trials > 0 && groupsDoneRef.current >= trials) { finish(); return; }
    if (spawnRef.current) clearTimeout(spawnRef.current);
    spawnRef.current = setTimeout(() => {
      if (!runningRef.current || pausedRef.current) return;
      spawnGroup();
    }, delay);
  };

  const placeTarget = (size) => {
    if (!boardSize.w || !boardSize.h) return { x: 0, y: 0 };
    const pad = 8;
    const W = Math.max(0, boardSize.w - (size + pad));
    const H = Math.max(0, boardSize.h - (size + pad));
    const x = rand(pad, W);
    const y = rand(pad, H);
    return { x, y };
  };

  function pickFillPtForWord(wordEn) {
    const ptForWord = EN_TO_PT[wordEn];
    const available = currentPtButtons;
    // baixa chance de coincidir com a palavra (20%)
    if (Math.random() < 0.2 && available.includes(ptForWord)) return ptForWord;
    // escolhe uma cor diferente da palavra
    const others = available.filter(k => k !== ptForWord);
    return others[Math.floor(Math.random() * others.length)] || ptForWord;
  }

  const spawnGroup = () => {
    const size = cfgRef.current.size;
    const pos = placeTarget(size);

    // Palavra correta (EN) e cor de preenchimento (PT) com baixa chance de coincidir
    const wordEn = currentEnWords[Math.floor(Math.random() * currentEnWords.length)];
    const fillPt = pickFillPtForWord(wordEn);

    const now = Date.now();
    const scale = new Animated.Value(0);
    const target = { id: uid(), x: pos.x, y: pos.y, wordEn, fillPt, created: now, scale };

    setTargets([target]);
    groupStartRef.current = now;
    setElapsedMs(0);

    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  };

  // Adaptação por bloco (alvo 85% acurácia) e mentor
  const onEndOfGroup = () => {
    const done = groupsDoneRef.current;
    const trials = Number(cfgRef.current.trials) || 0;

    if (trials > 0 && done >= trials) return false;

    let showed = false;
    if (done > 0 && done % MENTOR_EVERY_ROUNDS === 0) {
      const acc = Math.round((hits / done) * 100);
      let msg = '';
      if (acc >= 90) msg = 'Ótima precisão; acelere um pouco mantendo a qualidade.';
      else if (acc <= 75) msg = 'Precisão baixa. Veja o estímulo completo antes de tocar.';
      else msg = 'Ritmo adequado. Continue!';

      setTargets([]);
      setBlockBanner(`Bloco ${done / MENTOR_EVERY_ROUNDS}: acc ${acc}%`);
      setMentorMsg(msg);
      showed = true;
      setTimeout(() => { setBlockBanner(null); setMentorMsg(null); scheduleNextGroup(0); }, MESSAGE_SHOW_MS);
    }
    return showed;
  };

  // Clicar nos botões (em PT). Correto se botão == EN_TO_PT[wordEn]
  const onColorButton = async (ptKey) => {
    if (!runningRef.current || pausedRef.current) return;
    setPressedBtn(ptKey);
    setTimeout(() => setPressedBtn(null), 160);

    const t = targets[0];
    if (!t) return;

    const expectedPt = EN_TO_PT[t.wordEn];
    if (ptKey === expectedPt) {
      const rt = Date.now() - groupStartRef.current;
      setLastRt(rt);
      setTimes(arr => [...arr, rt]);
      setHits(h => h + 1);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // some sempre após a resposta
      groupsDoneRef.current += 1;
      setTargets([]);

      const intermission = onEndOfGroup();
      if (!intermission) scheduleNextGroup(350);
    } else {
      setWrongClicks(w => w + 1);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // mesmo na errada: conta rodada, some e segue fluxo de mensagem/pausa
      groupsDoneRef.current += 1;
      setTargets([]);

      const intermission = onEndOfGroup();
      if (!intermission) scheduleNextGroup(350);
    }
  };

  const pauseResume = () => {
    if (!running) return;
    if (!paused) {
      setPaused(true); setStatusMsg('Pausado'); cleanupAllTimers();
    } else {
      setPaused(false); setStatusMsg('Vai!'); scheduleNextGroup(0);
    }
  };

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

  const currentSnapshot = useMemo(() => {
    const s = computeStats(times);
    const percent = cfg.trials > 0 ? Math.round((hits / cfg.trials) * 100) : 0;
    return { ...s, hits, misses, wrongClicks, trials: cfg.trials, percent, player: displayName || 'Convidado', at: Date.now(), difficulty };
  }, [times, hits, misses, wrongClicks, cfg.trials, displayName, difficulty]);

  const percentNow = groupsDoneRef.current > 0
    ? Math.round((hits / groupsDoneRef.current) * 100)
    : 0;

  const finish = async () => {
    setRunning(false); runningRef.current = false;
    setPaused(false); pausedRef.current = false;
    cleanupAllTimers();
    setStatusMsg('Fim!');

    const s = computeStats(times);

    // calcule UMA vez e use a mesma variável
    const percent = cfg.trials > 0 ? Math.round((hits / cfg.trials) * 100) : 0;

    // Envio ao Supabase sem bloquear a UI
    saveThinkfast90Result({
      displayName,
      difficulty,
      stats: s,
      percent,
      hits,
    }).catch(e => console.log('[thinkfast90] saveThinkfast90Result failed', e));

    await maybeSaveUserBest(s);
    await maybeSaveGlobalRecords(s);

    if (percent >= 70) playVictory(); else playDefeat();

    // Brainpower e FOCUS (pré vs sessão)
    const pre = computeStats(preRts);
    const focusPre = pre.med ? Math.round(100000 / pre.med) : null;
    const focusPost = s.med ? Math.round(100000 / s.med) : null;
    const focusDelta = (focusPre != null && focusPost != null) ? (focusPost - focusPre) : null;

    // use "percent" (já definido) aqui
    const brainpower = (s.avg && percent != null) ? Math.max(1, Math.round((percent / 100) * 100000 / s.avg)) : null;

    const session = {
      ...s,
      hits,
      misses,
      wrongClicks,
      trials: cfg.trials,
      percent, // <-- era percent2 (não existe)
      player: displayName || 'Convidado',
      at: Date.now(),
      difficulty,
      brainpower,
      focusPre,
      focusPost,
      focusDelta,
    };
    setLastStats(session);
    setShowResults(true);
    AsyncStorage.setItem('thinkfast90:last', JSON.stringify(session)).catch(() => {});
    // histórico
    try {
      const raw = await AsyncStorage.getItem('thinkfast90:history');
      const hist = raw ? JSON.parse(raw) : [];
      hist.unshift(session);
      await AsyncStorage.setItem('thinkfast90:history', JSON.stringify(hist.slice(0, 50)));
    } catch {}
  };

  const maybeSaveUserBest = async (finalStats) => {
    if (!finalStats || !finalStats.count) return;
    const betterAvg = bestUser.avg == null || finalStats.avg < bestUser.avg;
    const betterSingle = bestUser.best == null || finalStats.best < bestUser.best;
    if (betterAvg || betterSingle) {
      const updated = {
        avg: betterAvg ? finalStats.avg : bestUser.avg,
        best: betterSingle ? finalStats.best : bestUser.best,
        count: finalStats.count,
        name: displayName || 'Convidado',
      };
      setBestUser(updated);
      try { await AsyncStorage.setItem('thinkfast90:bestUser', JSON.stringify(updated)); } catch {}
    }
  };

  const maybeSaveGlobalRecords = async (finalStats) => {
    if (!finalStats || !finalStats.count) return;
    const key = difficulty === 'hard' ? 'hard' : 'normal';
    let r = { ...records }; let changed = false;
    if (finalStats.best != null && (r[key].bestSingleMs == null || finalStats.best < r[key].bestSingleMs)) {
      r[key].bestSingleMs = finalStats.best; r[key].bestSingleName = displayName || 'Convidado'; changed = true;
    }
    if (finalStats.avg != null && (r[key].bestAvgMs == null || finalStats.avg < r[key].bestAvgMs)) {
      r[key].bestAvgMs = finalStats.avg; r[key].bestAvgName = displayName || 'Convidado'; changed = true;
    }
    if (changed) { setRecords(r); try { await AsyncStorage.setItem('thinkfast90:records', JSON.stringify(r)); } catch {} }
  };

  // (2) HOOKS DE GATING: adicionar onde preferir entre os primeiros hooks
  const { plano } = usePlano();                   // plano atual (ex: FREE, PREMIUM, etc)
  const { open: openPaywall } = usePaywall();     // função para exibir a paywall
  const [startingGate, setStartingGate] = useState(false); // evita vários cliques iniciando ao mesmo tempo

  // (4) NOVA FUNÇÃO iniciarThinkfast90 COM GATING
  const iniciarThinkfast90 = useCallback(async () => {
    // Se já está rodando ou já verificando, não faz nada
    if (running) return;
    if (startingGate) return;
    setStartingGate(true); // trava botões até terminar verificação

    try {
      console.log('[TF90] iniciarThinkfast90 plano=', plano);
      const r = await tentarUsar('THINKFAST90', plano);
      console.log('[TF90] resultado tentarUsar', r);

      if (!r.ok) {
        if (r.erro === 'nao_logado') { return; }
        if (r.erro === 'limite') { openPaywall(); return; }
        if (r.erro === 'compra_unica_necessaria') { openPaywall('STF'); return; }
        if (r.erro === 'codigo_desconhecido') { start(); return; }
        return;
      }
      start();
    } finally {
      setStartingGate(false);
    }
  }, [running, startingGate, plano, openPaywall, start]);

  // (3) FUNÇÃO start original permanece igual
  // const start = () => { ... }

  // (6) CONTROLES: substituir start quando não estiver rodando
  const controlsStart = running ? pauseResume : iniciarThinkfast90;

  const insets = useSafeAreaInsets();
  // REMOVER cálculo antigo que subtrai e recoloca o inset
  // const headerPad = Math.max((insets.top > 24 ? insets.top - 6 : insets.top - 2), 0);
  const headerPad = 0; // não adiciona nada extra (usar só o safe area)

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <SafeAreaView
        style={[
          styles.container,
          {
            // NÃO defina paddingTop manual; SafeAreaView já aplica insets.top
            paddingBottom: Math.max(insets.bottom, 10)
          }
        ]}
        edges={['top','bottom','left','right']}  // mantém top, já suficiente
      >
        {/* Cabeçalho */}
        <View style={[styles.headerRow, { paddingTop: headerPad }]}>
          <TouchableOpacity onPress={() => { cleanupAllTimers(); navigation.goBack(); }} style={styles.iconBtn}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>ThinkFast 90</Text>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
            <Feather name="settings" size={18} color="#b2c7d3" />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          Jogador: {displayName || 'Convidado'} • Dificuldade: {difficulty === 'hard' ? 'Difícil' : 'Normal'}
          {(() => {
            const r = records[difficulty === 'hard' ? 'hard' : 'normal'];
            return (r?.bestSingleMs != null || r?.bestAvgMs != null)
              ? ` • Rec: clique ${r.bestSingleMs ?? '–'} ms / média ${r.bestAvgMs ?? '–'} ms` : '';
          })()}
        </Text>

        {/* Onboarding / Intro (mantido centralizado) */}
        {showIntro && (
          <View style={styles.introOverlay} pointerEvents="box-none">
            <View style={styles.introCard} pointerEvents="auto">
              <Text style={styles.introTitle}>Ajuste mental em minutos</Text>
              <Text style={styles.introText}>
                Thinkfast mede com alta precisão e acurácia um conjunto de habilidades cognitivas saturado de g dentro do intervalo de 65 a 135 de QI. Fora desse intervalo, mede velocidade de raciocínio para tarefas simples, e esse atributo não está fortemente correlacionado com a inteligência nos níveis mais altos. 
                {'\n\n'} REGRAS: clique no botão onde a cor escrita corresponde a cor escrita na bolinha que aparecer na tela, seja o mais rápido possível.
              </Text>

              {/* Botão iniciar centralizado */}
              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <TouchableOpacity
                  style={[
                    styles.introBtn,
                    { minWidth: 180 },
                    startingGate && { opacity: 0.5 } // feedback visual enquanto checa
                  ]}
                  onPress={iniciarThinkfast90}
                  disabled={startingGate}            // desabilita enquanto verifica
                  activeOpacity={0.9}
                >
                  <Feather name="activity" size={20} color="#0a0f12" />
                  <Text style={styles.introBtnTxt}>
                    {startingGate ? '...' : 'Iniciar'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Escolha de dificuldade */}
              <View style={{ flexDirection: 'row', marginTop: 14, gap: 8, justifyContent: 'center' }}>
                <TouchableOpacity
                  onPress={() => setDifficulty('normal')}
                  style={[styles.diffPill, difficulty === 'normal' && styles.diffPillActive]}>
                  <Text style={[styles.diffPillTxt, difficulty === 'normal' && styles.diffPillTxtActive]}>Normal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDifficulty('hard')}
                  style={[styles.diffPill, difficulty === 'hard' && styles.diffPillActive]}>
                  <Text style={[styles.diffPillTxt, difficulty === 'hard' && styles.diffPillTxtActive]}>Difícil</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Tabuleiro */}
        <View
          style={styles.board}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setBoardSize({ w: width, h: height });
          }}
        >
          <View style={styles.boardHud}>
            <Text style={styles.hudTxt}>Alvos: {groupsDoneRef.current}/{cfg.trials}</Text>
            <Text style={styles.hudTxt}>{statusMsg} {lastRt != null ? `• Último RT: ${lastRt} ms` : ''}</Text>
          </View>

          {(blockBanner || mentorMsg) && (
            <View style={styles.messagesOverlay} pointerEvents="none">
              {blockBanner ? (
                <Text style={[styles.blockBannerTxt, styles.messageBig]}>{blockBanner}</Text>
              ) : null}
              {mentorMsg ? (
                <Text style={[styles.mentorTxt, styles.messageBig, { marginTop: blockBanner ? 8 : 0 }]}>{mentorMsg}</Text>
              ) : null}
            </View>
          )}

          {/* Cronômetro do alvo atual */}
          {targets.length > 0 && (
            <View style={styles.cronoWrap} pointerEvents="none">
              <Text style={styles.cronoText}>{elapsedMs} ms</Text>
            </View>
          )}

          {targets.map(t => (
            <Animated.View
              key={t.id}
              style={[
                styles.target,
                {
                  width: cfg.size,
                  height: cfg.size,
                  left: t.x,
                  top: t.y,
                  borderRadius: cfg.size / 2,
                  transform: [{ scale: t.scale }],
                  shadowColor: PT_COLORS[t.fillPt],
                },
              ]}
            >
              {/* Não é para clicar na bolinha; o acerto é pelo botão da cor escrita */}
              <View
                style={[
                  styles.hitArea,
                  { borderColor: PT_COLORS[t.fillPt], backgroundColor: hexToRgba(PT_COLORS[t.fillPt]) },
                ]}
              >
                <Text style={[
                  styles.ballText,
                  difficulty === 'hard' && styles.ballTextHard,
                  { fontSize: cfg.ballFontSize }
                ]}>
                  {t.wordEn}
                </Text>
              </View>
            </Animated.View>
          ))}

          {countdown !== null && (
            <View style={styles.countdownOverlay} pointerEvents="box-none">
              <Text style={styles.countdownText}>{countdown === 0 ? 'Já!' : countdown}</Text>
            </View>
          )}

          {running && paused && (
            <View style={styles.pausedOverlay} pointerEvents="box-none">
              <Feather name="pause" size={42} color="#fff" />
              <Text style={styles.pausedText}>Pausado</Text>
            </View>
          )}
        </View>

        {/* Botões de resposta (PT) */}
        <View style={[styles.buttonsRow, difficulty === 'hard' && styles.buttonsRowWrap]}>
          {currentPtButtons.map(k => (
            <TouchableOpacity
              key={k}
              style={[
                styles.colorBtn,
                pressedBtn === k && styles.colorBtnPressed,
              ]}
              onPress={() => onColorButton(k)}
              activeOpacity={0.9}
            >
              <Text style={styles.colorBtnTxt}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Stats linha */}
        <View style={styles.statsBar}>
          <Stat label="Média" value={`${currentSnapshot.avg ?? '–'} ms`} />
          <Stat label="Melhor" value={`${currentSnapshot.best ?? '–'} ms`} />
          <Stat label="Acertos" value={hits} />
          <Stat label="Erros" value={wrongClicks} />
          <Stat label="Pontuação" value={`${percentNow}%`} />
        </View>

        {/* Controles centralizados */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[
              styles.ctrlBtn,
              running ? (paused ? styles.btnResume : styles.btnPause) : styles.btnStart,
              (!running && startingGate) && { opacity: 0.5 } // trava visual se checando
            ]}
            onPress={controlsStart}
            disabled={!running && startingGate}
            activeOpacity={0.9}
          >
            <Feather name={!running ? 'play' : (paused ? 'play' : 'pause')} size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>
              {!running
                ? (startingGate ? '...' : 'Iniciar')
                : (paused ? 'Retomar' : 'Pausar')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.btnStop]}
            onPress={finish}
            disabled={!running}
          >
            <Feather name="square" size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>Parar</Text>
          </TouchableOpacity>
        </View>

        {/* Configurações (sem Perfil interno e sem rampas) */}
        <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              {/* Removido Perfil interno */}

              <Text style={[styles.modalTitle, { marginTop: 0 }]}>Recordes</Text>
              <View style={{ paddingVertical: 6, rowGap: 6 }}>
                <Text style={styles.label}>
                  Fácil • Clique mais rápido: {records.normal?.bestSingleMs ?? '—'} ms {records.normal?.bestSingleName ? `• ${records.normal.bestSingleName}` : ''}
                </Text>
                <Text style={styles.label}>
                  Fácil • Média mais rápida: {records.normal?.bestAvgMs ?? '—'} ms {records.normal?.bestAvgName ? `• ${records.normal.bestAvgName}` : ''}
                </Text>
                <Text style={[styles.label, { marginTop: 6 }]}>
                  Difícil • Clique mais rápido: {records.hard?.bestSingleMs ?? '—'} ms {records.hard?.bestSingleName ? `• ${records.hard.bestSingleName}` : ''}
                </Text>
                <Text style={styles.label}>
                  Difícil • Média mais rápida: {records.hard?.bestAvgMs ?? '—'} ms {records.hard?.bestAvgName ? `• ${records.hard.bestAvgName}` : ''}
                </Text>
              </View>

              <Text style={[styles.modalTitle, { marginTop: 10 }]}>Ajustes</Text>

              <View style={styles.row}>
                <Text style={styles.label}>Dificuldade</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => setDifficulty('normal')} style={[styles.diffPill, difficulty === 'normal' && styles.diffPillActive]}>
                    <Text style={[styles.diffPillTxt, difficulty === 'normal' && styles.diffPillTxtActive]}>Normal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDifficulty('hard')} style={[styles.diffPill, difficulty === 'hard' && styles.diffPillActive]}>
                    <Text style={[styles.diffPillTxt, difficulty === 'hard' && styles.diffPillTxtActive]}>Difícil</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Alvos: já digitável (mantido) */}
              <View style={styles.row}>
                <Text style={styles.label}>Alvos (rodadas)</Text>
                <TextInput
                  style={styles.numericInput}
                  value={String(cfg.trials)}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  maxLength={3}
                  onChangeText={(text) => {
                    const v = parseInt((text || '').replace(/\D/g, ''), 10);
                    setCfg(c => ({ ...c, trials: isNaN(v) ? c.trials : Math.max(1, v) }));
                  }}
                />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setShowSettings(false)}>
                  <Text style={styles.closeBtnTxt}>Fechar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Resultados */}
        <Modal visible={showResults} transparent animationType="fade" onRequestClose={() => setShowResults(false)}>
          <View style={styles.modalWrap}>
            <View style={styles.resultsCard}>
             <View style={styles.resultsHeader}>
               <TouchableOpacity
                 style={styles.resultsBackBtn}
                 onPress={() => { setShowResults(false); navigation.goBack(); }}
                 activeOpacity={0.8}
               >
                 <Feather name="arrow-left" size={20} color="#fff" />
               </TouchableOpacity>
             </View>
              {(() => {
                const s = lastStats ?? currentSnapshot;
                return (s?.percent ?? 0) >= 70 ? (
                  <ConfettiCannon
                    count={140}
                    origin={{ x: 0, y: 0 }}
                    fadeOut
                    explosionSpeed={320}
                    fallSpeed={2600}
                    colors={['#ffd166', '#00d3aa', '#f1c40f', '#ffffff', '#9ad8ff']}
                    style={{ position:'absolute', inset:0, pointerEvents:'none' }}
                  />
                ) : null;
              })()}

              <Text style={styles.resultsTitle}>Resultados</Text>

              <Text style={styles.sectionTitle}>Recorde (modo {difficulty === 'hard' ? 'Difícil' : 'Normal'})</Text>
              {(() => {
                const r = records[difficulty === 'hard' ? 'hard' : 'normal'];
                return (
                  <>
                    <View style={styles.resRow}>
                      <Text style={styles.resK}>Clique mais rápido</Text>
                      <Text style={styles.resV}>{r?.bestSingleMs != null ? `${r.bestSingleMs} ms • ${r.bestSingleName || '—'}` : '—'}</Text>
                    </View>
                    <View style={styles.resRow}>
                      <Text style={styles.resK}>Média mais rápida</Text>
                      <Text style={styles.resV}>{r?.bestAvgMs != null ? `${r.bestAvgMs} ms • ${r.bestAvgName || '—'}` : '—'}</Text>
                    </View>
                  </>
                );
              })()}

              <Text style={[styles.sectionTitle, { marginTop: 10 }]}>Sessão</Text>
              {(() => {
                const s = lastStats ?? currentSnapshot;
                return (
                  <>
                    <View style={styles.resRow}><Text style={styles.resK}>Jogador</Text><Text style={styles.resV}>{s?.player || '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Modo</Text><Text style={styles.resV}>{s?.difficulty === 'hard' ? 'Difícil' : 'Normal'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Pontuação</Text><Text style={styles.resV}>{s?.percent != null ? `${s.percent}%` : '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Média</Text><Text style={styles.resV}>{s?.avg != null ? `${s.avg} ms` : '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Melhor</Text><Text style={styles.resV}>{s?.best != null ? `${s.best} ms` : '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Mediana</Text><Text style={styles.resV}>{s?.med != null ? `${s.med} ms` : '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Desv. padrão</Text><Text style={styles.resV}>{s?.sd != null ? `${s.sd} ms` : '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Acertos</Text><Text style={styles.resV}>{s?.hits ?? '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Erros</Text><Text style={styles.resV}>{s?.wrongClicks ?? '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>Brainpower</Text><Text style={styles.resV}>{s?.brainpower ?? '—'}</Text></View>
                    <View style={styles.resRow}><Text style={styles.resK}>FOCUS pré → pós</Text><Text style={styles.resV}>
                      {(s?.focusPre ?? null) != null && (s?.focusPost ?? null) != null ? `${s.focusPre} → ${s.focusPost} (${s.focusDelta >= 0 ? 'subiu' : 'caiu'})` : '—'}
                    </Text></View>
                  </>
                );
              })()}

              <View style={styles.resultsActions}>
                <TouchableOpacity
                  style={[styles.resBtn, styles.resBtnPrimary, startingGate && { opacity: 0.5 }]}
                  onPress={() => { setShowResults(false); iniciarThinkfast90(); }}
                  disabled={startingGate}
                  activeOpacity={0.9}
                >
                  <Feather name="refresh-ccw" size={16} color="#0a0f12" />
                  <Text style={styles.resBtnTxtPrimary}>
                    {startingGate ? '...' : 'Jogar de novo'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={() => { setShowResults(false); setShowSettings(true); }}>
                  <Feather name="settings" size={16} color="#fff" />
                  <Text style={styles.resBtnTxtGhost}>Configurações</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={() => { setShowResults(false); setShowIntro(true); }}>
                  <Text style={styles.resBtnTxtGhost}>Fechar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const Stat = ({ label, value }) => (
  <View style={styles.statItem}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const Stepper = ({ value, onDec, onInc, step = 1 }) => (
  <View style={styles.stepper}>
    <TouchableOpacity onPress={onDec}><Feather name="minus" color="#b2c7d3" size={16} /></TouchableOpacity>
    <Text style={styles.stepVal}>{value}</Text>
    <TouchableOpacity onPress={onInc}><Feather name="plus" color="#b2c7d3" size={16} /></TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 10 },        // removido paddingBottom fixo
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  iconBtn: { padding: 6 },
  title: { fontSize: 22, color: '#fff', fontWeight: '800', letterSpacing: 0.3 },
  subtitle: { fontSize: 11, color: '#b2c7d3', marginBottom: 6 },

  board: {
    flex: 0.72,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  boardHud: {
    position: 'absolute', top: 8, left: 8, right: 8, zIndex: 2,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  hudTxt: { color: '#b2c7d3', fontSize: 11 },

  blockBanner: {
    position: 'absolute', top: 30, left: 0, right: 0, alignItems: 'center', zIndex: 3,
  },
  blockBannerTxt: { color: '#ffd166', fontWeight: '800', fontSize: 12, backgroundColor: '#00000040', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },

  mentorBanner: {
    position: 'absolute', top: 54, left: 10, right: 10, alignItems: 'center', zIndex: 3,
  },
  mentorTxt: { color: '#d1e8ff', fontSize: 16, backgroundColor: '#00000040', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, textAlign: 'center' },
  // Centralização das mensagens no meio do jogo
  messagesOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  messageBig: {
    fontSize: 20,
    textAlign: 'center',
  },
  cronoWrap: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: '#00000055',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 5,
  },
  cronoText: { color: '#ffd166', fontWeight: '800', fontSize: 14 },
  target: { position: 'absolute', elevation: 6 },
  hitArea: { flex: 1, borderWidth: 3, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ballText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.5, color: '#0a0f12' },
  ballTextHard: { color: '#ffd166' },

  buttonsRow: { flexDirection: 'row', justifyContent: 'space-evenly', marginTop: 8, gap: 8, flexWrap: 'wrap' },
  buttonsRowWrap: { flexWrap: 'wrap' },
  colorBtn: {
    flexGrow: 1, flexBasis: '30%',
    marginHorizontal: 4, backgroundColor: '#ffffff15', paddingVertical: 14, borderRadius: 14,
    alignItems: 'center',
    // aparência neutra (sem glow retangular no Android)
    backgroundColor: '#ffffff15',
    borderWidth: 1,
    borderColor: '#ffffff22',
    // sombra só no iOS; no Android, sem elevation para evitar retângulo
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#ffd166',
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        }
      : {
          elevation: 0,
        }),
  },
  colorBtnTxt: { color: '#fff', fontWeight: '800' },
  colorBtnPressed: {
    backgroundColor: '#ffffff30',
    borderColor: '#ffd166',
    borderWidth: 2,
    transform: [{ scale: 0.98 }],
    ...(Platform.OS === 'ios'
      ? {
          shadowOpacity: 0.6,
          shadowRadius: 12,
        }
      : {
          elevation: 0,
        }),
  },

  // Controles centralizados
  controlsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, justifyContent: 'center', gap: 10 },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20 },
  ctrlTxt: { marginLeft: 8, fontWeight: '700', color: '#0a0f12', fontSize: 14 },
  btnStart: { backgroundColor: '#00d3aa' },
  btnPause: { backgroundColor: '#ffd166' },
  btnResume: { backgroundColor: '#00d3aa' },
  btnStop: { backgroundColor: '#ff6b6b' },

  statsBar: {
    flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 6, justifyContent: 'space-between',
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
  },
  statItem: { alignItems: 'center', minWidth: '14%' },
  statLabel: { color: '#b2c7d3', fontSize: 11 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 2 },

  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  countdownText: { color: '#fff', fontSize: 64, fontWeight: '800' },

  pausedOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  pausedText: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 8 },

  introOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  introCard: { width: '90%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 16 },
  introTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  introText: { color: '#d1e8ff', fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: 'center' },
  introBtn: { backgroundColor: '#00d3aa', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  introBtnTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 14, marginLeft: 8 },

  diffPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#ffffff15', borderWidth: 1, borderColor: '#ffffff22' },
  diffPillActive: { backgroundColor: '#ffd166' },
  diffPillTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  diffPillTxtActive: { color: '#0a0f12' },

  preOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  preCard: { width: '88%', backgroundColor: '#101828', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, alignItems: 'center' },
  preTitle: { color: '#ffd166', fontSize: 16, fontWeight: '800' },
  preText: { color: '#d1e8ff', fontSize: 13, marginTop: 6, textAlign: 'center' },
  preClickBtn: { marginTop: 14, backgroundColor: '#ffd166', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 22 },
  preClickTxt: { color: '#0a0f12', fontSize: 18, fontWeight: '900', letterSpacing: 1 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '90%', backgroundColor: '#101828', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  label: { color: '#b2c7d3', fontSize: 13 },
  input: {
    marginLeft: 12, paddingVertical: 8, paddingHorizontal: 10, color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 10, minWidth: 160,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepVal: { color: '#fff', fontSize: 14, width: 56, textAlign: 'center' },
  range: { color: '#b2c7d3', fontSize: 12 },
  numericGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numericInput: {
    width: 100, paddingVertical: 6, paddingHorizontal: 8, color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8, textAlign: 'center',
  },
  closeBtn: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#ffffff10', borderRadius: 12 },
  closeBtnTxt: { color: '#fff', fontWeight: '700' },

  resultsCard: { width: '90%', backgroundColor: '#101828', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
 resultsHeader: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 4 },
 resultsBackBtn: { padding: 4, marginLeft: -4 },
  resultsTitle: { color: '#fff', fontWeight: '800', fontSize: 18, marginBottom: 8, alignSelf: 'center' },
  sectionTitle: { color: '#ffd166', fontWeight: '800', fontSize: 13, marginTop: 6, marginBottom: 6 },
  resRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  resK: { color: '#b2c7d3', fontSize: 12 },
  resV: { color: '#fff', fontSize: 14, fontWeight: '700' },
  resultsActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 10, flexWrap: 'wrap' },
  resBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  resBtnPrimary: { backgroundColor: '#00d3aa' },
  resBtnGhost: { backgroundColor: '#ffffff10' },
  resBtnTxtPrimary: { color: '#0a0f12', fontWeight: '800', marginLeft: 8 },
  resBtnTxtGhost: { color: '#fff', fontWeight: '700', marginLeft: 8 },
});