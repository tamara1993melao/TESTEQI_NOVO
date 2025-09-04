import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Modal, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
let ConfettiCannon;
try {
  ConfettiCannon = require('react-native-confetti-cannon').default;
} catch { ConfettiCannon = () => null; }
import { supabase } from '../supabaseClient';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// GATING (novos imports)
import { usePlano } from '../planoContext';
import { tentarUsar } from '../core/gatingLocal';
import { usePaywall } from '../paywallContext';
import { Dimensions } from 'react-native';

const rand = (a, b) => a + Math.random() * (b - a);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const COLORS = ['#00d3aa', '#ffd166', '#e74c3c', '#1abc9c', '#9b59b6', '#3498db'];
const NO_OVERLAP_GAP = 8; // folga entre alvos
// rand seguro (corrige intervalo invertido)
const randBetween = (a, b) => {
  if (b < a) [a, b] = [b, a];
  return a + Math.random() * (b - a);
};

// Nome público a partir do Perfil (profiles) e user_metadata
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

// Sons de fim de rodada
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
      mounted = false;
      Object.values(soundsRef.current).forEach(s => s && s.unloadAsync());
    };
  }, []);

  const play = async (k) => {
    const s = soundsRef.current[k];
    if (!s) return;
    try {
      await s.stopAsync();
      await s.setPositionAsync(0);
      await s.playAsync();
    } catch {}
  };

  return {
    playVictory: () => play('victory'),
    playDefeat: () => play('defeat'),
  };
}

// Presets de tamanho (reduz risco de travar ao recalcular layout)
const SIZE_PRESETS = { pequeno: 48, medio: 66, grande: 84 }; // ADICIONE (antes do componente)

export default function ThinkFast({ navigation }) {
  return (
    <SafeAreaProvider>
      <ThinkFastInner navigation={navigation} />
    </SafeAreaProvider>
  );
}

function ThinkFastInner({ navigation }) {
  // Plano / Paywall (novos)
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();

  // Safe area
  const insets = useSafeAreaInsets();
  const statusTop = insets.top || 0;
  // Mesma “sensação” da tela Testes (56 px total incluindo status bar):
  const headerTop = Math.max(0, 56 - statusTop); 
  // Assim: SafeArea dá statusTop e o View do header recebe apenas o restante para completar 56.
  // Se quiser exatamente igual ao Testes sem SafeArea, pode usar direto paddingTop: 56 no header e remover o cálculo.

  // UI e sessão
  const [showIntro, setShowIntro] = useState(false);

  // ===== MODO DE JOGO (NOVO BLOCO) =====
  const [modeModalVisible, setModeModalVisible] = useState(true); // abre primeiro
  const [mode, setMode] = useState(null); // 'normal' | 'desafio' | 'torneio'
  const modeSelected = !!mode;

  function selectMode(m) {
    setMode(m);
    // Caso queira lógica específica:
    // if (m === 'desafio') { /* ex: alterar trials depois */ }
    setModeModalVisible(false);
    // Agora libera a intro original
    setShowIntro(true);
  }

  function reopenModeModal() {
    setModeModalVisible(true);
    setShowIntro(false);
  }
  
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Pronto. Toque em Iniciar.');
  const [countdown, setCountdown] = useState(null);

  // Nome público (Perfil.js / Supabase)
  const [displayName, setDisplayName] = useState('Convidado');

  // Alvos
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  const boardRef = useRef(null);
  const boardSizeRef = useRef({ w: 0, h: 0 }); // NOVO: ref sempre atual
  const [targets, setTargets] = useState([]);

  // Fila de ordem e pontuação
  const [orderQueue, setOrderQueue] = useState([]); // ids na ordem de spawn
  const [score, setScore] = useState(0);            // 1 ponto em ordem; 0,5 fora de ordem

  // Estatísticas
  const [spawned, setSpawned] = useState(0);
  const [times, setTimes] = useState([]); // tempos de reação (ms) – apenas acertos
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);

  // Recordes (locais por app) e “melhor do usuário”
  const [bestUser, setBestUser] = useState({ avg: null, best: null, hits: 0, name: '' });
  const [records, setRecords] = useState({
    bestSingleMs: null, bestSingleName: '', bestSingleAt: null,
    bestAvgMs: null, bestAvgName: '', bestAvgAt: null,
  });

  // Máximo de bolinhas (hits + misses) já alcançado localmente
  const [bestTotal, setBestTotal] = useState(0);

  // Resultados pós-rodada
  const [showResults, setShowResults] = useState(false);
  const [lastStats, setLastStats] = useState(null);
  const [finalSessionData, setFinalSessionData] = useState(null);

  // Melhor sequência correta desta sessão
  const [bestStreak, setBestStreak] = useState({ count: 0, timeMs: null });
  const streakRef = useRef({ count: 0, startAt: 0, bestCount: 0, bestTimeMs: null });

  // Configurações (base)
  const [cfg, setCfg] = useState({
    trials: 30,
    delayMin: 350,
    delayMax: 900,
    ttl: 1800,
    size: 66,
    maxConcurrent: 5,
    tournamentId: '',
    rampEvery: 10,
    rampDelayMs: 40,
    rampTtlMs: 60,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [tempCfg, setTempCfg] = useState(cfg);

  // Timers/anim
  const spawnRef = useRef(null);
  const ttlTimersRef = useRef({});
  const entryAnim = useRef(new Animated.Value(0)).current;

  // Refs reativas
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const targetsRef = useRef([]);
  const spawnedRef = useRef(0);
  const orderQueueRef = useRef([]);
  const hitsRef = useRef(0);

  // ADICIONE ESTA LINHA (ref faltando)
  const spawnStartedRef = useRef(false);

  // Sons de fim
  const { playVictory, playDefeat } = useEndSounds();

  // Gating lock (novo)
  const [startingGate, setStartingGate] = useState(false);

  // ADICIONE refs auxiliares
  const debug = false; // mude para true se quiser logs
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  // Timer para "checkEmpty"
  const finishCheckRef = useRef(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { targetsRef.current = targets; }, [targets]);
  useEffect(() => { spawnedRef.current = spawned; }, [spawned]);
  useEffect(() => { orderQueueRef.current = orderQueue; }, [orderQueue]);
  useEffect(() => { hitsRef.current = hits; }, [hits]);

  useEffect(() => {
    Animated.timing(entryAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    loadPersisted();
    return () => cleanupAllTimers();
  }, []);

  useEffect(() => {
    if (showSettings) setTempCfg(cfg);
  }, [showSettings, cfg]);

  useEffect(() => {
    AsyncStorage.setItem('thinkfast:cfg', JSON.stringify(cfg)).catch(() => {});
  }, [cfg]);

  const loadPersisted = async () => {
    try {
      const bu = await AsyncStorage.getItem('thinkfast:bestUser');
      if (bu) setBestUser(JSON.parse(bu));
      const rc = await AsyncStorage.getItem('thinkfast:records');
      if (rc) setRecords(JSON.parse(rc));
      const c = await AsyncStorage.getItem('thinkfast:cfg');
      if (c) {
        const parsed = JSON.parse(c);
        setCfg(prev => ({ ...prev, ...parsed, trials: parsed?.trials ?? prev.trials }));
      }
      const last = await AsyncStorage.getItem('thinkfast:last');
      if (last) setLastStats(JSON.parse(last));
      const dn = await fetchDisplayName();
      setDisplayName(dn);
      const bt = await AsyncStorage.getItem('thinkfast:bestTotal');
      if (bt) setBestTotal(Number(bt) || 0);
    } catch {}
  };

  const updateStreakOnHit = (now) => {
    if (streakRef.current.count === 0) streakRef.current.startAt = now;
    streakRef.current.count += 1;
    const elapsed = now - streakRef.current.startAt;
    const better =
      streakRef.current.count > streakRef.current.bestCount ||
      (streakRef.current.count === streakRef.current.bestCount &&
        (streakRef.current.bestTimeMs == null || elapsed < streakRef.current.bestTimeMs));
    if (better) {
      streakRef.current.bestCount = streakRef.current.count;
      streakRef.current.bestTimeMs = elapsed;
      setBestStreak({ count: streakRef.current.bestCount, timeMs: streakRef.current.bestTimeMs });
    }
  };
  const breakStreak = () => {
    streakRef.current.count = 0;
    streakRef.current.startAt = 0;
  };

  const maybeSaveUserBest = async (finalStats) => {
    if (!finalStats || !finalStats.count) return;
    const betterAvg = bestUser.avg == null || finalStats.avg < bestUser.avg;
    const betterSingle = bestUser.best == null || finalStats.best < bestUser.best;
    if (betterAvg || betterSingle) {
      const updated = {
        avg: betterAvg ? finalStats.avg : bestUser.avg,
        best: betterSingle ? finalStats.best : bestUser.best,
        hits: finalStats.count,
        name: displayName || 'Convidado',
      };
      setBestUser(updated);
      try { await AsyncStorage.setItem('thinkfast:bestUser', JSON.stringify(updated)); } catch {}
    }
  };

  const maybeSaveGlobalRecords = async (finalStats) => {
    if (!finalStats || !finalStats.count) return;
    let r = { ...records };
    let changed = false;
    if (finalStats.best != null && (r.bestSingleMs == null || finalStats.best < r.bestSingleMs)) {
      r.bestSingleMs = finalStats.best;
      r.bestSingleName = displayName || 'Convidado';
      r.bestSingleAt = Date.now();
      changed = true;
    }
    if (finalStats.avg != null && (r.bestAvgMs == null || finalStats.avg < r.bestAvgMs)) {
      r.bestAvgMs = finalStats.avg;
      r.bestAvgName = displayName || 'Convidado';
      r.bestAvgAt = Date.now();
      changed = true;
    }
    if (changed) {
      setRecords(r);
      try { await AsyncStorage.setItem('thinkfast:records', JSON.stringify(r)); } catch {}
    }
  };

  const cleanupAllTimers = () => {
    if (spawnRef.current) clearTimeout(spawnRef.current);
    Object.values(ttlTimersRef.current).forEach(t => clearTimeout(t));
    ttlTimersRef.current = {};
  };

  const resetAll = () => {
    console.log('[ThinkFast] resetAll');
    spawnStartedRef.current = false; // <-- novo
    cleanupAllTimers();
    if (finishCheckRef.current) {
      clearTimeout(finishCheckRef.current);
      finishCheckRef.current = null;
    }
    setRunning(false);
    setPaused(false);
    setStatusMsg('Pronto. Toque em Iniciar.');
    setTargets([]);
    setOrderQueue([]);
    setScore(0);
    setSpawned(0);
    setTimes([]);
    setHits(0);
    setMisses(0);
    setCountdown(null);
    streakRef.current = { count: 0, startAt: 0, bestCount: 0, bestTimeMs: null };
    setBestStreak({ count: 0, timeMs: null });
  };

  const scheduleSpawn = (initialDelay, trialsSnapshot) => {
    const targetTrials = Number(trialsSnapshot) || 0; // snapshot fixo
    if (debug) console.log('[ThinkFast] scheduleSpawn targetTrials=', targetTrials);
    const loop = (delay) => {
      spawnRef.current = setTimeout(() => {
        if (!runningRef.current || pausedRef.current) return;

        const did = spawnTarget();

        if (did) {
          setSpawned(prev => {
            const next = prev + 1;
            spawnedRef.current = next;
          if (debug && next % 25 === 0) console.log('[ThinkFast] spawned', next);
            if (targetTrials > 0 && next >= targetTrials) {
              // Só agenda verificação; não gera mais spawns
              const checkEmpty = () => {
                if (!runningRef.current || pausedRef.current) return;
                if (targetsRef.current.length === 0) {
                  if (debug) console.log('[ThinkFast] finish after empty board');
                  // finish();  // <-- ANTIGO
                  finishGame(); // <-- NOVO (ou poderia manter finish() pois alias acima cobre)
                } else {
                  finishCheckRef.current = setTimeout(checkEmpty, 200);
                }
              };
              checkEmpty();
              return next;
            }
            return next;
          });
        }

        // Se ainda não atingiu limite (ou é infinito) continue
        if (!(targetTrials > 0 && spawnedRef.current >= targetTrials)) {
          const { delayMin, delayMax } = getEffectiveParams();
            // Se não spawnou por saturação, tenta logo de novo
          const nextDelay = did ? Math.round(rand(delayMin, delayMax)) : 90;
          loop(nextDelay);
        }
      }, delay);
    };
    const { delayMin, delayMax } = getEffectiveParams();
    loop(initialDelay ?? Math.round(rand(delayMin, delayMax)));
  };

  function startSpawning(trialsSnapshot) {
    if (spawnStartedRef.current) {
      console.log('[ThinkFast] startSpawning ignorado (já iniciou)');
      return;
    }
    spawnStartedRef.current = true;
    const bs = boardSizeRef.current;
    console.log('[ThinkFast] startSpawning (boardSize=', bs.w, bs.h, ') trials=', trialsSnapshot);
    scheduleSpawn(50, trialsSnapshot);

    // Watchdog: se nada spawnou, tenta manual e depois força schedule imediato
    setTimeout(() => {
      if (runningRef.current && targetsRef.current.length === 0) {
        console.log('[ThinkFast] watchdog: nenhum alvo -> spawnTarget()');
        const ok = spawnTarget();
        if (!ok) {
          console.log('[ThinkFast] watchdog: spawnTarget falhou -> scheduleSpawn(0)');
          scheduleSpawn(0, trialsSnapshot);
        }
      }
    }, 600);
  }

  const startCountdown = async (trialsSnapshot) => {
    console.log('[ThinkFast] startCountdown init trials=', trialsSnapshot);
    setShowIntro(false);
    setCountdown(3);
    safeHaptic(); // <--- usa throttle
    const tick = (n) => {
      console.log('[ThinkFast] countdown', n);
      setCountdown(n);
      if (n === 0) {
        setCountdown(null);
        setRunning(true);
        runningRef.current = true;
        setPaused(false);
        pausedRef.current = false;
        setStatusMsg('Vai!');
        safeHaptic(); // substitui vibração direta
        startSpawning(trialsSnapshot);
        setStartingGate(false);
        return;
      }
      setTimeout(() => tick(n - 1), 1000);
    };
    tick(3);
  };

  const start = () => {
    // Garante que não inicia sem escolha (segurança extra)
    if (!modeSelected) {
      setModeModalVisible(true);
      setShowIntro(false);
      setStatusMsg('Escolha um modo');
      return;
    }

    let trialsSnapshot = Number(cfgRef.current.trials) || 0; // 0 = infinito

    // Placeholder para lógica futura de modos:
    if (mode === 'desafio') {
      // Exemplo: forçar trials ilimitados (remova se não quiser agora)
      // trialsSnapshot = 0;
      // setCfg(prev => ({ ...prev, trials: 0 }));
    }
    if (mode === 'torneio') {
      // Exemplo (futuro): aplicar cfg específica de torneio
      // trialsSnapshot = 50;
    }

    resetAll();
    startCountdown(trialsSnapshot);
  };

  // GATING: função para iniciar (substitui start direto nos botões)
  const debugTF = true; // garanta true para logs

  // INSERIR logs auxiliares nas funções já existentes (adicione dentro delas):
  // Exemplo (edite cada função real):
  // function resetAll() { console.log('[ThinkFast] resetAll'); ... }
  // const startCountdown = async (trialsSnapshot) => { console.log('[ThinkFast] startCountdown begin trials=', trialsSnapshot); ... }
  // const start = () => { console.log('[ThinkFast] start() disparado'); ... }

  // Substituir/definir iniciarThinkFast:
  const iniciarThinkFast = useCallback(() => {
    console.log('[ThinkFast] === iniciarThinkFast === runningRef=', runningRef.current, 'startingGate=', startingGate, 'plano=', plano);

    if (runningRef.current) {
      console.log('[ThinkFast] abort: já em execução');
      return;
    }
    if (startingGate) {
      console.log('[ThinkFast] abort: startingGate true');
      return;
    }

    setStartingGate(true);
    setStatusMsg('Verificando acesso...');
    const trialsSnapshot = Number(cfgRef.current?.trials) || 0;

    let finalizado = false;
    let fallbackTimer = setTimeout(() => {
      if (!finalizado) {
        console.log('[ThinkFast] Fallback timeout -> iniciando (falha gating/haptics?)');
        liberar('fallback');
      }
    }, 1500);

    const limparFallback = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const liberar = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      limparFallback();
      console.log('[ThinkFast] LIBERAR start motivo=', motivo);
      setStatusMsg('Iniciando...');
      try {
        resetAll();
        // NÃO setStartingGate(false) aqui; só após countdown terminar (ou dentro de tick)
        startCountdown(trialsSnapshot)
          .catch(e => {
            console.log('[ThinkFast] startCountdown erro', e);
            setStartingGate(false);
          });
      } catch (e) {
        console.log('[ThinkFast] exceção ao iniciar', e);
        setStartingGate(false);
      }
    };

    const bloquear = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      limparFallback();
      console.log('[ThinkFast] BLOQUEADO motivo=', motivo);
      setStatusMsg('Acesso bloqueado. Plano necessário.');
      setStartingGate(false);
      openPaywall?.();
    };

    (async () => {
      try {
        console.log('[ThinkFast] gating: chamar tentarUsar? tipo=', typeof tentarUsar);
        if (typeof tentarUsar === 'function') {
          const r = await tentarUsar('THINKFAST', plano);
          console.log('[ThinkFast] tentarUsar retorno', r);
          if (r && r.ok === false) {
            if (r.erro === 'limite' || r.erro === 'compra_unica_necessaria') {
              bloquear(r.erro);
              return;
            }
            console.log('[ThinkFast] erro não crítico no gating -> liberar');
            liberar('erro-nao-critico');
            return;
          }
          liberar('ok');
        } else {
          console.log('[ThinkFast] tentarUsar ausente -> liberar');
          liberar('sem-funcao');
        }
      } catch (e) {
        console.log('[ThinkFast] exceção tentarUsar', e);
        liberar('excecao');
      }
    })();
  }, [plano, startingGate, openPaywall]);

  // Envio da sessão ao Supabase
  const saveToSupabase = async (session) => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uidUser = auth?.user?.id || null;
      const payload = {
        user_id: uidUser,
        user_name: (displayName || 'Convidado').slice(0, 80),
        tournament_id: cfg.tournamentId || null,
        avg_ms: session.avg ?? null,
        best_single_ms: session.best ?? null,
        best_streak_count: session.bestStreakCount ?? null,
        best_streak_time_ms: session.bestStreakTimeMs ?? null,
        hits: session.hits ?? null,
        misses: session.misses ?? null,
        trials: session.trials ?? null,
        percent: session.percent ?? null,
        score: session.tournamentScore ?? null,
        total_count: session.total ?? null, // NOVO
      };
      await supabase.from('thinkfast_results').insert(payload);
    } catch (e) {
      console.log('Supabase insert error:', e?.message || e);
    }
  };

  const getEffectiveParams = useCallback(() => {
    const stage = Math.max(0, Math.floor(hitsRef.current / (cfg.rampEvery || 10)));
    const delayMin = Math.max(150, cfg.delayMin - stage * (cfg.rampDelayMs || 0));
    const delayMax = Math.max(delayMin + 50, cfg.delayMax - stage * (cfg.rampDelayMs || 0));
    const ttl = Math.max(400, cfg.ttl - stage * (cfg.rampTtlMs || 0));
    return { delayMin, delayMax, ttl };
  }, [cfg]);

  const finishGame = useCallback((opts = {}) => {
    const { suppressResults = false } = opts;
    cleanupAllTimers();
    setRunning(false);
    setPaused(false);
    setStatusMsg('Fim!');
    setTimes(currentTimes => {
      setHits(currentHits => {
        setMisses(currentMisses => {
          setScore(currentScore => {
            const s = computeStats(currentTimes);
            maybeSaveUserBest(s);
            maybeSaveGlobalRecords(s);

            const percent = (currentHits + currentMisses) > 0
              ? Math.round((currentScore / (currentHits + currentMisses)) * 100)
              : 0;

            const bestStreakCount = streakRef.current.bestCount || 0;
            const bestStreakTimeMs = streakRef.current.bestTimeMs ?? null;

            const tournamentScore = (s.avg && percent != null)
              ? Math.max(1, Math.round((percent / 100) * 100000 / s.avg))
              : null;

            if (!suppressResults) {
              if (percent >= 70) playVictory(); else playDefeat();
            }

            const session = {
              ...s,
              hits: currentHits,
              misses: currentMisses,
              total: currentHits + currentMisses,
              trials: cfg.trials,
              player: displayName || 'Convidado',
              score: Number(currentScore.toFixed(1)),
              percent,
              at: Date.now(),
              bestStreakCount,
              bestStreakTimeMs,
              tournamentScore,
            };

            if (session.total > bestTotal) {
              setBestTotal(session.total);
              AsyncStorage.setItem('thinkfast:bestTotal', String(session.total)).catch(()=>{});
            }

            setFinalSessionData(session);
            setLastStats(session);
            AsyncStorage.setItem('thinkfast:last', JSON.stringify(session)).catch(() => {});
            saveToSupabase(session);

            if (!suppressResults) {
              setTimeout(() => setShowResults(true), 16);
            }
            return currentScore;
          });
          return currentMisses;
        });
        return currentHits;
      });
      return currentTimes;
    });
  }, [cfg.trials, bestTotal, displayName, playVictory, playDefeat]);

  // >>> ALIAS para compatibilidade com chamadas antigas
  const finish = (...a) => finishGame(...a);

  const pauseResume = () => {
    if (!running) return;
    if (!paused) {
      setPaused(true);
      setStatusMsg('Pausado');
      cleanupAllTimers();
    } else {
      setPaused(false);
      setStatusMsg('Vai!');
      const { ttl } = getEffectiveParams();
      targetsRef.current.forEach(t => {
        if (ttlTimersRef.current[t.id]) clearTimeout(ttlTimersRef.current[t.id]);
        ttlTimersRef.current[t.id] = setTimeout(() => {
          if (!runningRef.current) return;
          setTargets(prev => {
            const exists = prev.find(x => x.id === t.id);
            if (!exists) return prev;
            setMisses(m => m + 1);
            setOrderQueue(q => q.filter(id => id !== t.id));
            breakStreak();
            return prev.filter(x => x.id !== t.id);
          });
        }, ttl);
      });
      scheduleSpawn(0, Number(cfgRef.current?.trials) || 0);
    }
  };

  // REMOVER a função startSpawning antiga e SUBSTITUIR por esta:
  function startSpawning(trialsSnapshot) {
    if (spawnStartedRef.current) {
      console.log('[ThinkFast] startSpawning ignorado (já iniciou)');
      return;
    }
    spawnStartedRef.current = true;
    const bs = boardSizeRef.current;
    console.log('[ThinkFast] startSpawning (boardSize=', bs.w, bs.h, ') trials=', trialsSnapshot);
    scheduleSpawn(50, trialsSnapshot);

    // Watchdog: se nada spawnou, tenta manual e depois força schedule imediato
    setTimeout(() => {
      if (runningRef.current && targetsRef.current.length === 0) {
        console.log('[ThinkFast] watchdog: nenhum alvo -> spawnTarget()');
        const ok = spawnTarget();
        if (!ok) {
          console.log('[ThinkFast] watchdog: spawnTarget falhou -> scheduleSpawn(0)');
          scheduleSpawn(0, trialsSnapshot);
        }
      }
    }, 600);
  }

  // === NOVO: função para posicionar alvo sem sobrepor (usar antes de spawnTarget) ===
  function placeTarget() {
    const bs = boardSizeRef.current; // usar ref
    const size = (cfgRef.current?.size) || 60;
    const maxX = Math.max(0, bs.w - size);
    const maxY = Math.max(0, bs.h - size);
    const gap = NO_OVERLAP_GAP;
    const minDist = size + gap;
    const minDistSq = minDist * minDist;

    if (bs.w <= 0 || bs.h <= 0) {
      if (true) console.log('[ThinkFast] placeTarget abort boardSize inválido', bs);
      return { x: 0, y: 0 };
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.round(randBetween(0, maxX));
      const y = Math.round(randBetween(0, maxY));
      let overlap = false;
      for (const t of targetsRef.current) {
        const dx = (t.x - x);
        const dy = (t.y - y);
        if ((dx * dx + dy * dy) < minDistSq) {
          overlap = true;
          break;
        }
      }
      if (!overlap) return { x, y };
    }
    const fx = Math.round(randBetween(0, maxX));
    const fy = Math.round(randBetween(0, maxY));
    console.log('[ThinkFast] placeTarget fallback (muitas tentativas)');
    return { x: fx, y: fy };
  }
  // === FIM NOVO ===

  const spawnTarget = () => {
    if (!runningRef.current) { if (true) console.log('[ThinkFast] spawnTarget abort: !running'); return false; }
    if (pausedRef.current) { if (true) console.log('[ThinkFast] spawnTarget abort: paused'); return false; }
    const bs = boardSizeRef.current;
    if (bs.w <= 0 || bs.h <= 0) {
      if (true) console.log('[ThinkFast] spawnTarget boardSize 0 -> retry curto', bs);
      setTimeout(() => {
        if (runningRef.current && !pausedRef.current) spawnTarget();
      }, 80);
      return false;
    }
    if (targetsRef.current.length >= cfgRef.current.maxConcurrent) {
      if (true) console.log('[ThinkFast] spawnTarget abort: maxConcurrent atingido');
      return false;
    }

    const id = uid();
    const pos = placeTarget();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const scale = new Animated.Value(0);
    const target = { id, x: pos.x, y: pos.y, t: Date.now(), color, scale };

    setTargets(prev => [...prev, target]);
    setOrderQueue(q => [...q, id]);
    if (true) console.log('[ThinkFast] spawnTarget OK id=', id, 'pos=', pos);

    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();

    const { ttl } = getEffectiveParams();
    ttlTimersRef.current[id] = setTimeout(() => {
      if (!runningRef.current) return;
      setTargets(prev => {
        const exists = prev.find(t => t.id === id);
        if (!exists) return prev;
        setMisses(m => m + 1);
        setOrderQueue(q => q.filter(x => x !== id));
        breakStreak();
        return prev.filter(t => t.id !== id);
      });
    }, ttl);

    return true;
  };

  const onTargetPress = async (id) => {
    if (!runningRef.current || pausedRef.current) return;
    const now = Date.now();
    setTargets(prev => {
      const t = prev.find(x => x.id === id);
      if (!t) return prev;
      const dt = now - t.t;

      const inOrder = orderQueueRef.current[0] === id;
      setScore(s => Number((s + (inOrder ? 1 : 0.5)).toFixed(1)));
      setOrderQueue(q => (inOrder ? q.slice(1) : q.filter(x => x !== id)));

      setTimes(arr => [...arr, dt]);
      setHits(h => h + 1);
      updateStreakOnHit(now);
      safeHaptic(); // substitui vibração direta
      if (ttlTimersRef.current[id]) {
        clearTimeout(ttlTimersRef.current[id]);
        delete ttlTimersRef.current[id];
      }
      return prev.filter(x => x.id !== id);
    });
  };

  const computeStats = (arr) => {
    if (!arr || arr.length === 0) return { count: 0, avg: null, med: null, sd: null, best: null };
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.round(Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length));
    const best = Math.min(...arr);
    return { count: arr.length, avg, med, sd, best };
  };

  const stats = useMemo(() => computeStats(times), [times]);

  const currentSnapshot = useMemo(() => {
    const s = computeStats(times);
    const percent = (hits + misses) > 0 ? Math.round((score / (hits + misses)) * 100) : 0;
    return {
      ...s,
      hits,
      misses,
      total: hits + misses,
      trials: cfg.trials,
      player: displayName || 'Convidado',
      score: Number(score.toFixed(1)),
      percent,
      at: Date.now(),
    };
  }, [times, hits, misses, score, cfg.trials, displayName]);

  const percentNow = (hits + misses) > 0 ? Math.round((score / (hits + misses)) * 100) : 0;
  const restantes = useMemo(() => {
    const t = Number(cfg.trials) || 0;
    if (t === 0) return null;
    return Math.max(t - spawned, 0);
  }, [cfg.trials, spawned]);

  // === ADIÇÕES (logo após declarações de outros useState) ===
  const [hapticsOn, setHapticsOn] = useState(true);
  const lastHapticRef = useRef(0);
  const HAPTIC_EVERY = 2; // vibra a cada 2 acertos (ajuste se quiser mais/menos)

  const safeHaptic = useCallback(() => {
    if (!hapticsOn) return;
    // vibração apenas a cada HAPTIC_EVERY acertos (usa hitsRef)
    if (hitsRef.current % HAPTIC_EVERY !== 0) return;
    const now = Date.now();
    if (now - lastHapticRef.current < 120) return;
    lastHapticRef.current = now;
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  }, [hapticsOn]);
  // === FIM ADIÇÕES ===

  // ...existing code (até antes de startCountdown)...

  // === ADIÇÃO: função para abrir configurações encerrando partida se necessário ===
  const openSettings = useCallback(() => {
    if (runningRef.current) {
      // encerra a partida sem mostrar resultados
      finishGame({ suppressResults: true });
    }
    // aplica snapshot atual das configs antes de editar
    setTempCfg(cfgRef.current);
    setShowSettings(true);
  }, [finishGame]);
  // === FIM ADIÇÃO ===

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 10 }} edges={['top','left','right','bottom']}>
        <View style={[styles.headerRow, {
          paddingTop: headerTop
        }]}>
          <TouchableOpacity
            onPress={() => { cleanupAllTimers(); navigation.goBack(); }}
            style={styles.iconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>ThinkFast</Text>
          <TouchableOpacity
            onPress={reopenModeModal}
            style={styles.iconBtn}
          >
            <Feather name="layers" size={18} color="#b2c7d3" />
          </TouchableOpacity>
          <TouchableOpacity onPress={openSettings} style={styles.iconBtn}>
            <Feather name="settings" size={18} color="#b2c7d3" />
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          Jogador: {displayName || 'Convidado'}
          {records.bestSingleMs != null || records.bestAvgMs != null
            ? ` • Rec app: clique ${records.bestSingleMs ?? '–'} ms / média ${records.bestAvgMs ?? '–'} ms` : ''}
          {` • Máx bolinhas: ${bestTotal}`}
        </Text>

        {/* Tabuleiro */}
        <View
          ref={boardRef}
          style={[styles.board, { marginTop: 4 }]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            console.log('[ThinkFast] onLayout boardSize=', width, height);
            const sz = { w: width, h: height };
            boardSizeRef.current = sz; // manter ref atualizada
            setBoardSize(sz);
          }}
        >
          <View style={styles.boardHud}>
            {cfg.trials > 0 && (
              <Text style={styles.hudTxt}>Restantes: {restantes}</Text>
            )}
            <Text style={styles.hudTxt}>{statusMsg}</Text>
          </View>

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
                    shadowColor: t.color,
                  },
                ]}
              >
                <TouchableOpacity
                  style={[styles.hitArea, { borderColor: t.color, backgroundColor: t.color + '22' }]}
                  activeOpacity={0.7}
                  onPress={() => onTargetPress(t.id)}
                />
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

        {/* Controles */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[
              styles.ctrlBtn,
              running ? (paused ? styles.btnResume : styles.btnPause) : styles.btnStart,
              (!running && startingGate) && { opacity: 0.5 }
            ]}
            onPress={running ? pauseResume : iniciarThinkFast}
            disabled={!running && startingGate}
            activeOpacity={0.9}
          >
            <Feather name={!running ? 'play' : (paused ? 'play' : 'pause')} size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>
              {!running ? (startingGate ? '...' : 'Iniciar') : (paused ? 'Retomar' : 'Pausar')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.ctrlBtn, styles.btnStop]} onPress={finishGame} disabled={!running}>
            <Feather name="square" size={18} color="#0a0f12" />
            <Text style={styles.ctrlTxt}>Parar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsBar}>
          <Stat label="Média" value={`${stats.avg ?? '–'} ms`} />
          <Stat label="Melhor" value={`${stats.best ?? '–'} ms`} />
          <Stat label="Mediana" value={`${stats.med ?? '–'} ms`} />
            <Stat label="Desv.Pad" value={`${stats.sd ?? '–'} ms`} />
          <Stat label="Acertos" value={hits} />
          <Stat label="Erros" value={misses} />
          <Stat label="Pontuação" value={`${percentNow}%`} />
        </View>

        {/* Intro */}
        {showIntro && (
          <View style={styles.introOverlay} pointerEvents="box-none">
            <View style={styles.introCard} pointerEvents="auto">
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Feather name="zap" size={22} color="#ffd166" />
                <Text style={styles.introTitle}>ThinkFast</Text>
              </View>

              <Text style={styles.introText}>
                Toque nas bolinhas o mais rápido possível. Várias podem aparecer ao mesmo tempo.
                Regra: toque na ordem em que surgem. Fora de ordem vale 0,5 ponto.
                Escolha em configurações quantos alvos.
              </Text>

              <Text style={styles.infoTitle}>O que este teste mede</Text>
              <Text style={styles.infoText}>
                • Tempo de reação simples (ms){'\n'}
                • Atenção sustentada e seletiva{'\n'}
                • Controle inibitório (erros por omissão/pressa){'\n'}
                A pontuação considera a média, o melhor tempo e a consistência (desvio padrão).
              </Text>

              <TouchableOpacity
                style={[
                  styles.introBtn,
                  (startingGate || !modeSelected) && { opacity: 0.5 }
                ]}
                onPress={() => {
                  if (!modeSelected) {
                    reopenModeModal();
                    return;
                  }
                  iniciarThinkFast();
                }}
                disabled={startingGate}
                activeOpacity={0.9}
              >
                <Feather name="play-circle" size={22} color="#0a0f12" />
                <Text style={styles.introBtnTxt}>{startingGate ? '...' : 'Começar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Modal Ajustes */}
        <Modal
          visible={showSettings}
          transparent
          animationType="fade"
          onRequestClose={() => { setTempCfg(cfg); setShowSettings(false); }}
        >
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={[styles.modalTitle, { marginTop: 0 }]}>Ajustes</Text>

              <View className="row" style={styles.row}>
                <Text style={styles.label}>ID do Torneio (opcional)</Text>
                <TextInput
                  placeholder="ex: T2025-01"
                  placeholderTextColor="#8aa0ad"
                  value={tempCfg.tournamentId}
                  onChangeText={(v) => setTempCfg(c => ({ ...c, tournamentId: v }))}
                  style={[styles.input, { minWidth: 140 }]}
                />
              </View>

              <View style={styles.row}>
                <Text style={styles.label}>Alvos totais (0 = infinito)</Text>
                <TextInput
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#8aa0ad"
                  value={String(tempCfg.trials ?? 0)}
                  onChangeText={(v) => {
                    const n = Math.max(0, parseInt((v || '').replace(/\D/g, ''), 10) || 0);
                    setTempCfg(c => ({ ...c, trials: n }));
                  }}
                  style={[styles.input, { minWidth: 100, textAlign: 'center' }]}
                />
              </View>

              <View style={styles.row}>
                <Text style={styles.label}>Tamanho das bolinhas</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {Object.entries(SIZE_PRESETS).map(([k, v]) => {
                    const active = tempCfg.size === v;
                    return (
                      <TouchableOpacity
                        key={k}
                        onPress={() => setTempCfg(c => ({ ...c, size: v }))}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 8,
                          backgroundColor: active ? '#00d3aa' : 'rgba(255,255,255,0.08)',
                          borderWidth: 1,
                          borderColor: active ? '#00d3aa' : 'rgba(255,255,255,0.18)'
                        }}
                      >
                        <Text style={{ color: active ? '#0a0f12' : '#fff', fontWeight: '700', fontSize: 12 }}>
                          {k === 'pequeno' ? 'Peq' : k === 'medio' ? 'Méd' : 'Gra'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.row}>
                <Text style={styles.label}>Vibração</Text>
                <TouchableOpacity
                  onPress={() => setHapticsOn(v => !v)}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20,
                    backgroundColor: hapticsOn ? '#00d3aa' : 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    borderColor: hapticsOn ? '#00d3aa' : 'rgba(255,255,255,0.18)'
                  }}
                >
                  <Text style={{ color: hapticsOn ? '#0a0f12' : '#fff', fontWeight: '700', fontSize: 12 }}>
                    {hapticsOn ? 'Ativada' : 'Desativada'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 10 }}>
                <TouchableOpacity
                  style={[styles.closeBtn, { backgroundColor: '#ffffff10' }]}
                  onPress={() => { setTempCfg(cfg); setShowSettings(false); }}
                >
                  <Text style={styles.closeBtnTxt}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.closeBtn, { backgroundColor: '#ffd166' }]}
                  onPress={() => {
                    // Aplicar ajustes mas permanecer no modal (se quiser só aplicar)
                    setCfg(tempCfg);
                  }}
                >
                  <Text style={[styles.closeBtnTxt, { color: '#0a0f12', fontWeight: '800' }]}>Aplicar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.closeBtn, { backgroundColor: '#00d3aa' }]}
                  onPress={() => {
                    setCfg(tempCfg);          // aplica
                    setShowSettings(false);   // fecha
                    setTimeout(() => iniciarThinkFast(), 30); // inicia nova partida
                  }}
                >
                  <Text style={[styles.closeBtnTxt, { color: '#0a0f12', fontWeight: '800' }]}>Nova Partida</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal Resultados */}
        <Modal
          visible={showResults}
          transparent
          animationType="fade"
          onRequestClose={() => { setShowResults(false); setFinalSessionData(null); }}
        >
          <View style={styles.modalWrap}>
            {finalSessionData && (
              <View style={styles.resultsCard} key={finalSessionData.at}>
                {(finalSessionData.percent >= 70) && (
                  <ConfettiCannon
                    count={100}
                    origin={{ x: 0, y: 0 }}
                    fadeOut
                    explosionSpeed={320}
                    fallSpeed={2600}
                    colors={['#ffd166', '#00d3aa', '#f1c40f', '#ffffff', '#9ad8ff']}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
                  />
                )}

                <Text style={styles.resultsTitle}>Resultados</Text>

                <Text style={styles.sectionTitle}>Recorde do aplicativo</Text>
                <View style={styles.resRow}>
                  <Text style={styles.resK}>Clique mais rápido</Text>
                  <Text style={styles.resV}>
                    {records?.bestSingleMs != null ? `${records.bestSingleMs} ms • ${records.bestSingleName || '—'}` : '—'}
                  </Text>
                </View>
                <View style={styles.resRow}>
                  <Text style={styles.resK}>Média mais rápida</Text>
                  <Text style={styles.resV}>
                    {records?.bestAvgMs != null ? `${records.bestAvgMs} ms • ${records.bestAvgName || '—'}` : '—'}
                  </Text>
                </View>

                <Text style={[styles.sectionTitle, { marginTop: 10 }]}>Sessão Atual</Text>
                <View style={styles.resRow}><Text style={styles.resK}>Jogador</Text><Text style={styles.resV}>{finalSessionData.player || '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Pontuação</Text><Text style={styles.resV}>{finalSessionData.percent != null ? `${finalSessionData.percent}%` : '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Média</Text><Text style={styles.resV}>{finalSessionData.avg != null ? `${finalSessionData.avg} ms` : '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Melhor</Text><Text style={styles.resV}>{finalSessionData.best != null ? `${finalSessionData.best} ms` : '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Mediana</Text><Text style={styles.resV}>{finalSessionData.med != null ? `${finalSessionData.med} ms` : '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Desv. padrão</Text><Text style={styles.resV}>{finalSessionData.sd != null ? `${finalSessionData.sd} ms` : '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Acertos</Text><Text style={styles.resV}>{finalSessionData.hits ?? '—'}</Text></View>
                <View style={styles.resRow}><Text style={styles.resK}>Erros</Text><Text style={styles.resV}>{finalSessionData.misses ?? '—'}</Text></View>
                <View style={styles.resRow}>
                  <Text style={styles.resK}>Maior sequência correta</Text>
                  <Text style={styles.resV}>
                    {(finalSessionData.bestStreakCount ?? 0)}{finalSessionData.bestStreakTimeMs != null ? ` • ${finalSessionData.bestStreakTimeMs} ms` : ''}
                  </Text>
                </View>
                {finalSessionData.tournamentScore != null && (
                  <View style={styles.resRow}>
                    <Text style={styles.resK}>Score (torneio)</Text>
                    <Text style={styles.resV}>{finalSessionData.tournamentScore}</Text>
                  </View>
                )}

                <View style={styles.resultsActions}>
                  <TouchableOpacity
                    style={[styles.resBtn, styles.resBtnPrimary]}
                    onPress={() => { setShowResults(false); setFinalSessionData(null); iniciarThinkFast(); }}
                    activeOpacity={0.9}
                  >
                    <Feather name="refresh-ccw" size={16} color="#0a0f12" />
                    <Text style={styles.resBtnTxtPrimary}>Jogar de novo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.resBtn, styles.resBtnGhost]}
                    onPress={() => { setShowResults(false); setFinalSessionData(null); setShowSettings(true); }}
                  >
                    <Feather name="settings" size={16} color="#fff" />
                    <Text style={styles.resBtnTxtGhost}>Configurações</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.resBtn, styles.resBtnGhost]}
                    onPress={() => { setShowResults(false); setFinalSessionData(null); setShowIntro(true); }}
                  >
                    <Text style={styles.resBtnTxtGhost}>Fechar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Modal>

        {modeModalVisible && (
          <View style={styles.modeOverlay}>
            <Animated.View style={styles.modePanel}>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={[styles.iconBtn, { position: 'absolute', left: 12, top: 12, zIndex: 10 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="arrow-left" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modeTitle}>ThinkFast</Text>
              <Text style={styles.modeSubtitle}>Escolha um modo para continuar</Text>

              <View style={styles.modeCardsRow}>
                <ModeCardMini
                  title="Normal"
                  desc="Clássico equilibrado"
                  icon="zap"
                  colorActive="#00d3aa"
                  gradient={['#00d3aa', '#00b493']}
                  onPress={() => selectMode('normal')}
                  active={mode === 'normal'}
                />
                <ModeCardMini
                  title="Desafio"
                  desc="Variações diárias"
                  icon="target"
                  colorActive="#ffd166"
                  gradient={['#ffd166', '#ffb347']}
                  onPress={() => navigation.navigate('ThinkFastDesafio')}
                  active={mode === 'desafio'}
                />
                <ModeCardMini
                  title="Torneio"
                  desc="Competição (em breve)"
                  icon="award"
                  colorActive="#9b59b6"
                  gradient={['#9b59b6', '#7e3fa0']}
                  disabled
                  onPress={() => {}}
                  active={mode === 'torneio'}
                />
              </View>

              {!mode && (
                <Text style={styles.modeWarn}>Toque em um modo para habilitar o botão</Text>
              )}

              <TouchableOpacity
                disabled={!mode}
                onPress={() => {
                  setModeModalVisible(false);
                  setShowIntro(true);
                }}
                style={[
                  styles.modeContinueBtn,
                  !mode && { opacity: 0.35 }
                ]}
                activeOpacity={0.9}
              >
                <Text style={styles.modeContinueTxt}>{mode ? 'Continuar' : 'Selecione um modo'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (!mode) selectMode('normal');
                }}
                style={styles.modeQuick}
                activeOpacity={0.8}
              >
                <Text style={styles.modeQuickTxt}>
                  {mode ? 'Modo selecionado' : 'Ou entrar direto no Normal'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}
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

function ModeCardMini({ title, desc, icon, colorActive, gradient, onPress, active, disabled }) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        width: '31%',
        paddingVertical: 18,
        paddingHorizontal: 10,
        borderRadius: 24,
        backgroundColor: active ? colorActive : 'rgba(255,255,255,0.07)',
        borderWidth: 1,
        borderColor: active ? colorActive : 'rgba(255,255,255,0.14)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1
      }}
    >
      <Feather name={icon} size={24} color={colorActive} />
      <Text style={{
        color: '#fff',
        fontWeight: '800',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 5
      }}>{title}</Text>
      <Text style={{
        color: active ? '#0a0f12' : '#b2c7d3',
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 14
      }}>{desc}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 12,      // leve respiro
    minHeight: 44
  },
  iconBtn: { padding: 6 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: { fontSize: 11, color: '#b2c7d3', marginBottom: 6 },
  board: {
    flex: 1,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    position: 'relative'
  },
  boardHud: {
    position: 'absolute', top: 8, left: 8, right: 8, zIndex: 2,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  hudTxt: { color: '#b2c7d3', fontSize: 11 },
  target: { position: 'absolute', elevation: 6 },
  hitArea: { flex: 1, borderWidth: 2, borderRadius: 999 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, marginRight: 8 },
  ctrlTxt: { marginLeft: 8, fontWeight: '700', color: '#0a0f12', fontSize: 13 },
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
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  countdownText: { color: '#fff', fontSize: 64, fontWeight: '800' },
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pausedText: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 8 },
  introOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  introCard: {
    width: '90%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18, padding: 16
  },
  introTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  introText: { color: '#d1e8ff', fontSize: 14, lineHeight: 20, marginTop: 6 },
  introBtn: { marginTop: 12, backgroundColor: '#00d3aa', paddingVertical: 10, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  introBtnTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 16, marginLeft: 8 },
  infoTitle: { color: '#ffd166', fontWeight: '800', fontSize: 13, marginTop: 14, marginBottom: 6, alignSelf: 'center' },
  infoText: { color: '#d1e8ff', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '90%', backgroundColor: '#101828', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  label: { color: '#b2c7d3', fontSize: 13 },
  input: {
    marginLeft: 12, paddingVertical: 8, paddingHorizontal: 10, color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 10, minWidth: 160,
  },
  closeBtn: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  closeBtnTxt: { color: '#fff', fontWeight: '700' },
  resultsCard: {
    width: '90%', backgroundColor: '#101828', padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
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
  modeOverlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(6,15,22,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  modePanel: {
    width: '90%',
    backgroundColor: '#0f1722',
    borderRadius: 32,
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    opacity: 1,
    transform: [{ translateY: 0 }],
  },
  modeTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modeSubtitle: {
    color: '#b2c7d3',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  modeCardsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modeWarn: {
    color: '#ff8e8e',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  modeContinueBtn: {
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: '#00d3aa',
    paddingVertical: 12,
    paddingHorizontal: 50,
    borderRadius: 30,
  },
  modeContinueTxt: {
    color: '#0a0f12',
    fontWeight: '800',
    fontSize: 16,
  },
  modeQuick: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 26,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modeQuickTxt: {
    color: '#b2c7d3',
    fontWeight: '600',
    fontSize: 12,
  },
});