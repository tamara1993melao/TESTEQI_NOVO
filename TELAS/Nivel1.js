import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions
  // NativeEventEmitter  // REMOVIDO
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
let ConfettiCannon;
try {
  ConfettiCannon = require('react-native-confetti-cannon').default;
} catch { ConfettiCannon = () => null; }
import { Audio } from 'expo-av';
import { sequencias } from './dados/sequencias';
import { supabase } from '../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../planoContext';
import { tentarUsar } from '../core/gatingLocal';
import { usePaywall } from '../paywallContext';

// ---------------- CONFIG ----------------
const QUESTIONS_PER_LEVEL = 10;
const PASS_THRESHOLD = 0.7;
const CONFETTI_THRESHOLD = 80;
const STREAK_SKIP_FACIL = 6;
const LEVEL_ORDER = ['facil', 'medio', 'dificil'];

// Curiosidades educativas
const EDU_FACTS = [
  'Sequências numéricas treinam reconhecimento rápido de padrões, uma base do raciocínio lógico.',
  'Decifrar a regra exige memória de trabalho + abstração: dois pilares da inteligência fluida.',
  'Testes de padrões numéricos reduzem viés linguístico, medindo manipulação mental pura.',
  'Praticar sequências melhora a habilidade de antecipar relações e organizar o pensamento.',
  'Desmontar progressões e alternâncias fortalece a análise estrutural e a flexibilidade cognitiva.',
  'Inferir a “lei” escondida em poucos termos é exercício de inferência — chave para resolver problemas novos.',
  'Reconhecer padrões mais rápido libera recursos mentais para raciocinar em níveis mais complexos.'
];

// ----------- ÁUDIO (hook robusto vitória / derrota) -----------
function useEndSounds() {
  const soundsRef = useRef({ victory: null, defeat: null });
  const pendingRef = useRef(null);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true
        });
      } catch (e) { console.log('[AudioMode]', e); }

      const list = [
        ['victory', require('../assets/vitoria.mp3')],
        ['defeat', require('../assets/derrota.mp3')]
      ];

      try {
        await Promise.all(list.map(async ([k, mod]) => {
          const s = new Audio.Sound();
          await s.loadAsync(mod, { volume: 1.0, shouldPlay: false });
          if (mounted) soundsRef.current[k] = s;
        }));
        if (mounted) {
          setLoaded(true);
          if (pendingRef.current) {
            play(pendingRef.current);
            pendingRef.current = null;
          }
        }
      } catch (e) { console.log('[Som] falha', e); }
    })();

    return () => {
      mounted = false;
      Object.values(soundsRef.current).forEach(s => s && s.unloadAsync());
    };
    // eslint-disable-next-line
  }, []);

  const play = async (k) => {
    if (!enabled) return;
    const s = soundsRef.current[k];
    if (!s) {
      if (!loaded) pendingRef.current = k;
      return;
    }
    try {
      await s.stopAsync();
      await s.setPositionAsync(0);
      await s.playAsync();
    } catch (e) { console.log('[Som] erro play', k, e); }
  };

  return {
    playVictory: () => play('victory'),
    playDefeat: () => play('defeat'),
    toggleSound: () => setEnabled(e => !e),
    soundEnabled: enabled,
    soundsLoaded: loaded
  };
}

// --------------- HELPERS ---------------
const medalInfo = (p) => {
  if (p >= 95) return { icon: 'award', color: '#f1c40f', label: 'Excelente' };
  if (p >= 85) return { icon: 'zap', color: '#9ad8ff', label: 'Rápido' };
  if (p >= 70) return { icon: 'star', color: '#cd7f32', label: 'Bom' };
  return { icon: 'trending-up', color: '#888', label: 'Em Progresso' };
};

// ------------- RESULTADO DE NÍVEL -------------
const ResultadoNivel = ({ nivel, dados, resultadosAll, onRetry, onNext, onMenu }) => {
  const totalBase = dados.earlyFinish ? dados.totalRespondidas : QUESTIONS_PER_LEVEL;
  const percent = totalBase === 0 ? 0 : Math.round((dados.pontos / totalBase) * 100);
  const tempoMedio = dados.totalRespondidas ? (dados.tempoTotal / dados.totalRespondidas).toFixed(1) : 0;
  const m = medalInfo(percent);
  const passou = dados.earlyFinish || percent >= PASS_THRESHOLD * 100;
  const showConfetti = dados.earlyFinish || percent >= CONFETTI_THRESHOLD;

  const unlockedStars = LEVEL_ORDER.reduce((acc, lvl) => {
    const d = resultadosAll[lvl];
    if (!d) return acc;
    const base = d.earlyFinish ? d.totalRespondidas : QUESTIONS_PER_LEVEL;
    const p = base ? Math.round((d.pontos / base) * 100) : 0;
    if (d.earlyFinish || p >= PASS_THRESHOLD * 100) return acc + 1;
    return acc;
  }, 0);

  const starScales = [0, 1, 2].map(() => useRef(new Animated.Value(0)).current);
  useEffect(() => {
    starScales.forEach((av, i) => {
      if (i < unlockedStars) {
        Animated.sequence([
          Animated.delay(160 + i * 140),
          Animated.spring(av, { toValue: 1, friction: 5, useNativeDriver: true })
        ]).start();
      } else av.setValue(0);
    });
  }, [unlockedStars]);

  const factRef = useRef(EDU_FACTS[Math.floor(Math.random() * EDU_FACTS.length)]);
  useEffect(() => {
    factRef.current = EDU_FACTS[Math.floor(Math.random() * EDU_FACTS.length)];
  }, [dados.pontos, dados.totalRespondidas, dados.earlyFinish]);

  const mensagem =
    dados.earlyFinish
      ? `Série de ${STREAK_SKIP_FACIL} acertos: nível concluído antecipadamente!`
      : passou ? 'Excelente! Você pode subir o desafio.'
      : 'Avance no seu ritmo: consistência constrói padrão mental.';

  const { width } = Dimensions.get('window');

  return (
    <View style={styles.resultadoContainer}>
      {showConfetti && (
        <ConfettiCannon
          count={140}
          origin={{ x: width / 2, y: -10 }}
          fadeOut
          explosionSpeed={300}
          fallSpeed={2400}
          colors={['#ffd166', '#00d3aa', '#f1c40f', '#ffffff', '#2ec4b6']}
          style={styles.confettiLayer}
        />
      )}

      <Feather name={m.icon} size={82} color={m.color} />
      <Text style={styles.resTitulo}>{m.label}</Text>

      <Text style={styles.resLinha}>Nível: {nivel.toUpperCase()}</Text>
      <Text style={styles.resLinha}>
        Acertos: {dados.pontos}/{dados.earlyFinish ? dados.totalRespondidas : QUESTIONS_PER_LEVEL} ({percent}%)
      </Text>
      {dados.earlyFinish && (
        <Text style={[styles.resLinha, { color: '#00d3aa' }]}>
          Finalização antecipada (restante era bônus)
        </Text>
      )}
      <Text style={styles.resLinha}>Tempo total: {dados.tempoTotal}s</Text>
      <Text style={styles.resLinha}>Tempo médio: {tempoMedio}s / questão</Text>

      <View style={styles.starsRow}>
        {[0, 1, 2].map(i => {
          const lit = i < unlockedStars;
            return (
              <Animated.View
                key={i}
                style={{
                  transform: [{ scale: starScales[i].interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }],
                  opacity: lit ? 1 : 0.25
                }}
              >
                <Feather name="star" size={30} color={lit ? '#ffd166' : '#ffffff30'} style={{ marginHorizontal: 6 }} />
              </Animated.View>
            );
        })}
      </View>

      <Text style={styles.resMensagem}>{mensagem}</Text>

      <View style={styles.factBox}>
        <Text style={styles.factTitle}>Curiosidade Cognitiva</Text>
        <Text style={styles.factText}>{factRef.current}</Text>
      </View>

      <TouchableOpacity style={styles.btPrim} onPress={onNext}>
        <Text style={styles.btTexto}>{passou ? 'Avançar' : 'Seguir Mesmo Assim'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btSec} onPress={onRetry}>
        <Text style={styles.btTexto}>Refazer Nível</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btGhost} onPress={onMenu}>
        <Text style={styles.btGhostTxt}>Menu</Text>
      </TouchableOpacity>
    </View>
  );
};

// ------------- RESULTADO FINAL -------------
const ResultadoFinal = ({ resultados, onRestart, onMenu }) => {
  const percents = LEVEL_ORDER.map(l => {
    const d = resultados[l];
    if (!d) return { nivel: l, percent: 0 };
    const base = d.earlyFinish ? d.totalRespondidas : QUESTIONS_PER_LEVEL;
    return { nivel: l, percent: base === 0 ? 0 : Math.round((d.pontos / base) * 100) };
  });
  const media = Math.round(percents.reduce((a, b) => a + b.percent, 0) / LEVEL_ORDER.length);
  const med = medalInfo(media);
  const { width } = Dimensions.get('window');
  const showConfetti = media >= CONFETTI_THRESHOLD;

  return (
    <View style={styles.resultadoContainer}>
      {showConfetti && (
        <ConfettiCannon
          count={220}
          origin={{ x: width / 2, y: 0 }}
          fadeOut
          explosionSpeed={320}
          fallSpeed={2600}
          colors={['#ffd166', '#f1c40f', '#00d3aa', '#ffffff', '#9ad8ff', '#cd7f32']}
          style={styles.confettiLayer}
        />
      )}

      <Feather name={med.icon} size={90} color={med.color} />
      <Text style={styles.resTitulo}>Resumo Geral</Text>

      {percents.map(p => {
        const mi = medalInfo(p.percent);
        return (
          <View key={p.nivel} style={styles.finalLinha}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Feather name={mi.icon} size={18} color={mi.color} style={{ marginRight: 6 }} />
              <Text style={styles.finalNivel}>{p.nivel.toUpperCase()}</Text>
            </View>
            <Text style={styles.finalPercent}>{p.percent}%</Text>
          </View>
        );
      })}

      <View style={[styles.finalLinha, { borderTopWidth: 1, borderTopColor: '#ffffff15', paddingTop: 12, marginTop: 6 }]}>
        <Text style={styles.finalNivel}>MÉDIA</Text>
        <Text style={[styles.finalPercent, { color: med.color }]}>{media}%</Text>
      </View>

      <Text style={styles.explicativo}>
        Sequências numéricas avaliam reconhecimento de padrões, memória de trabalho e raciocínio
        lógico abstrato (inteligência fluida). Evoluir nelas melhora a capacidade de detectar
        estruturas, antecipar relações e organizar pensamento. Continue praticando para refinar
        velocidade e precisão.
      </Text>

      <TouchableOpacity style={styles.btPrim} onPress={onRestart}>
        <Text style={styles.btTexto}>Reiniciar</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btGhost} onPress={onMenu}>
        <Text style={styles.btGhostTxt}>Menu</Text>
      </TouchableOpacity>
    </View>
  );
};

// ------------- PRINCIPAL -------------
export default function Nivel1({ navigation }) {
  const [profileName, setProfileName] = useState('');
  const [userId, setUserId] = useState(null); // NOVO
  const [dificuldade, setDificuldade] = useState('facil');
  const [perguntas, setPerguntas] = useState([]);
  const [indice, setIndice] = useState(0);
  const [pontuacao, setPontuacao] = useState(0);
  const [fase, setFase] = useState('intro');
  const [resultados, setResultados] = useState({});
  const [streak, setStreak] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tempoTotal, setTempoTotal] = useState(0);
  const [tempoQuestoes, setTempoQuestoes] = useState([]);
  const [showIntro, setShowIntro] = useState(true);
  // >>> GATING (novo estado)
  const [startingGate, setStartingGate] = useState(false);

  // >>> GATING hooks
  const { plano } = usePlano();            // plano atual (ex: FREE, PREMIUM)
  const { open: openPaywall } = usePaywall(); // função que abre modal/paywall

  const cronRef = useRef(null);
  const questaoStartRef = useRef(Date.now());

  // ADICIONE (refs de animação que estavam ausentes)
  const progressAnim = useRef(new Animated.Value(0)).current;  // barra de progresso (0→1)
  const fadeQuestao = useRef(new Animated.Value(1)).current;   // fade in/out da questão
  const streakScale = useRef(new Animated.Value(0)).current;   // pulso do chip de streak

  const { playVictory, playDefeat, soundEnabled, toggleSound, soundsLoaded } = useEndSounds();

  // >>> GATING: função genérica para iniciar nível respeitando limites
  const iniciarComGating = useCallback(async (nivel = 'facil') => {
    if (startingGate) return;          // evita cliques múltiplos
    setStartingGate(true);
    try {
      console.log('[N1] tentarUsar NIVEL1 plano=', plano, 'nivel=', nivel);
      const r = await tentarUsar('NIVEL1', plano); // código da feature conforme tabela limites_funcionalidades
      console.log('[N1] resultado tentarUsar', r);

      if (!r.ok) {
        if (r.erro === 'nao_logado') {
          // opcional: navigation.navigate('Login');
          return;
        }
        if (r.erro === 'limite') {      // excedeu limite do plano
          openPaywall();
          return;
        }
        if (r.erro === 'compra_unica_necessaria') {
          openPaywall('NIVEL1');        // identifica produto/feature NIVEL1
          return;
        }
        if (r.erro === 'codigo_desconhecido') {
          // fallback: deixa jogar mesmo não reconhecendo código
          console.log('[N1] codigo_desconhecido -> fallback iniciar');
          setShowIntro(false);
          iniciarNivel(nivel);
          return;
        }
        return; // outros erros silenciam
      }
      // OK dentro do limite → inicia
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setShowIntro(false);
      iniciarNivel(nivel);
    } finally {
      setStartingGate(false);
    }
  }, [plano, iniciarNivel, startingGate, openPaywall]); // iniciarNivel é definido abaixo; se linter reclamar mova função acima ou desabilite regra

  // SUBSTITUI: startFromIntro original passa a chamar gating
  const startFromIntro = () => iniciarComGating('facil');

  // (Opcional) wrappers para reinício/refazer usando gating:
  const retryNivelGated = (nivel) => iniciarComGating(nivel);
  const restartAllGated = () => iniciarComGating('facil');

  // SUBSTITUIR o useEffect atual de loadProfileName por este:
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
        (u.email ? u.email.split('@')[0] : 'Convidado')
      );
    } catch {
      return 'Convidado';
    }
  }

  useEffect(() => {
    const loadProfileName = async () => {
      const name = await fetchDisplayName();
      setProfileName(name);
      const { data: authData } = await supabase.auth.getUser();
      setUserId(authData?.user?.id || null);
    };
    loadProfileName();
  }, []);

  useEffect(() => {
    return () => clearInterval(cronRef.current);
  }, []);

  // Salva no Supabase o melhor por nível (maior percent; empate -> menor tempo total; depois menor tempo médio)
  const saveBestToSupabase = async ({ level, pontos, totalRespondidas, percent, tempoTotal, tempoMedio }) => {
    try {
      // Garante nome atualizado se ainda vazio
      let user_name = profileName;
      if (!user_name) {
        user_name = await fetchDisplayName();
        setProfileName(user_name);
      }
      user_name = (user_name || 'Convidado').slice(0, 80);

      const payload = {
        user_id: userId,
        user_name,
        level,
        score: pontos,
        total_answered: totalRespondidas,
        percent,
        time_total_s: tempoTotal,
        avg_time_s: tempoMedio ?? null,
      };
      console.log('[seq] insert payload', payload);

      // HISTÓRICO: usar insert (não upsert)
      const { data, error } = await supabase
        .from('sequences_results')
        .insert(payload)
        .select('id,user_id,user_name,level,percent,time_total_s,avg_time_s,created_at');

      if (error) {
        console.log('[seq] insert ERROR', error);
      } else {
        console.log('[seq] insert OK', data);
      }
    } catch (e) {
      console.log('[seq] save exception', e);
    }
  };

  // Tornada function declaration para permitir uso antes (hoisted)
  function iniciarNivel(nivel) {
    clearInterval(cronRef.current);
    setDificuldade(nivel);
    setPerguntas(pickN(sequencias[nivel] || [], QUESTIONS_PER_LEVEL));
    setIndice(0);
    setPontuacao(0);
    setStreak(0);
    setSelected(null);
    setTempoTotal(0);
    setTempoQuestoes([]);
    setFase('jogando');
    questaoStartRef.current = Date.now();
    cronRef.current = setInterval(() => setTempoTotal(t => t + 1), 1000);
  };

  const finalizarNivel = (pontos, tempo, opts = {}) => {
    clearInterval(cronRef.current);
    let totalRespondidas;
    if (opts.answered != null) totalRespondidas = opts.answered;
    else if (tempoQuestoes.length > 0) totalRespondidas = tempoQuestoes.length;
    else totalRespondidas = indice + 1;

    const dadosNivel = {
      pontos,
      tempoTotal: tempo,
      totalRespondidas,
      tempos: tempoQuestoes,
      earlyFinish: !!opts.earlyFinish
    };
    const novos = { ...resultados, [dificuldade]: dadosNivel };
    setResultados(novos);

    const base = dadosNivel.earlyFinish ? dadosNivel.totalRespondidas : QUESTIONS_PER_LEVEL;
    const percent = Math.round((dadosNivel.pontos / base) * 100);
    if (dadosNivel.earlyFinish || percent >= PASS_THRESHOLD * 100) playVictory();
    else playDefeat();

    // Salva melhor no Supabase (maior percent; empate -> menor tempo total; depois menor tempo médio)
    const tempoMedio = dadosNivel.totalRespondidas
      ? Number((dadosNivel.tempoTotal / dadosNivel.totalRespondidas).toFixed(3))
      : null;
    saveBestToSupabase({
      level: dificuldade,
      pontos: dadosNivel.pontos,
      totalRespondidas: dadosNivel.totalRespondidas,
      percent,
      tempoTotal: dadosNivel.tempoTotal,
      tempoMedio,
    });

    const idx = LEVEL_ORDER.indexOf(dificuldade);
    if (idx === LEVEL_ORDER.length - 1) setFase('final');
    else setFase('resultado');
  };

  const avancarNivel = () => {
    const idx = LEVEL_ORDER.indexOf(dificuldade);
    if (idx < LEVEL_ORDER.length - 1) iniciarNivel(LEVEL_ORDER[idx + 1]);
    else setFase('final');
  };

  const registrarTempoQuestao = () => {
    const agora = Date.now();
    const delta = Math.round((agora - questaoStartRef.current) / 1000);
    setTempoQuestoes(arr => [...arr, delta]);
    questaoStartRef.current = agora;
  };

  const handleResposta = (op) => {
    if (fase !== 'jogando' || selected !== null || !perguntas[indice]) return;
    const correta = perguntas[indice].resposta;
    const acertou = op === correta;

    registrarTempoQuestao();
    setSelected(op);

    if (acertou) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const novoStreak = streak + 1;
      setStreak(novoStreak);
      setPontuacao(p => p + 1);
      if (novoStreak >= 2) {
        Animated.sequence([
          Animated.spring(streakScale, { toValue: 1, friction: 3, useNativeDriver: false }),
          Animated.timing(streakScale, { toValue: 0, duration: 250, useNativeDriver: false })
        ]).start();
      }
      if (dificuldade === 'facil' && novoStreak >= STREAK_SKIP_FACIL) {
        finalizarNivel(pontuacao + 1, tempoTotal, { earlyFinish: true, answered: novoStreak });
        return;
      }
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStreak(0);
    }

    setTimeout(() => {
      const ultima = indice === QUESTIONS_PER_LEVEL - 1;
      if (ultima) {
        const pontosFinais = acertou ? pontuacao + 1 : pontuacao;
        finalizarNivel(pontosFinais, tempoTotal);
      } else {
        Animated.sequence([
          Animated.timing(fadeQuestao, { toValue: 0, duration: 140, useNativeDriver: true }),
          Animated.timing(fadeQuestao, { toValue: 1, duration: 180, useNativeDriver: true })
        ]).start();
        setIndice(i => i + 1);
        setSelected(null);
      }
    }, 280);
  };

  // Reseta progresso quando inicia um nível/jogo novo
  useEffect(() => {
    if (fase === 'jogando') {
      progressAnim.setValue(
        QUESTIONS_PER_LEVEL <= 1 ? 1 : indice / (QUESTIONS_PER_LEVEL - 1)
      );
    }
  }, [fase, dificuldade]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anima avanço do índice na barra
  useEffect(() => {
    if (fase !== 'jogando') return;
    const target =
      QUESTIONS_PER_LEVEL <= 1 ? 1 : indice / (QUESTIONS_PER_LEVEL - 1);
    Animated.timing(progressAnim, {
      toValue: target,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start();
  }, [indice, fase]); // eslint-disable-line react-hooks/exhaustive-deps

  const barraWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const perguntaAtual = perguntas[indice];

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.container}>
      {/* Top bar nova (botões + título) */}
      <View className="topBar" style={styles.topBar}>
        <Text style={styles.appTitle}>Sequências</Text>
        <View style={styles.topButtons}>
          <TouchableOpacity onPress={toggleSound} style={styles.iconBtn}>
            <Feather name={soundEnabled ? 'volume-2' : 'volume-x'} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { clearInterval(cronRef.current); navigation.goBack(); }} style={styles.iconBtn}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
      

      {/* Linha de status (nível e streak apenas) */}
      <View style={styles.statusRow}>
        <View style={styles.statusChip}>
          <Feather name="layers" size={14} color="#00d3aa" style={{ marginRight: 4 }} />
          <Text style={styles.statusChipTxt}>Nível: {dificuldade}</Text>
        </View>
        {streak >= 2 && (
          <Animated.View style={[styles.statusChipHighlight, {
            transform: [{ scale: streakScale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }]
          }]}>
            <Feather name="trending-up" size={14} color="#0a0f12" style={{ marginRight: 4 }} />
            <Text style={[styles.statusChipTxtHighlight]}>Série {streak}x</Text>
          </Animated.View>
        )}
      </View>

      {/* Barra de progresso */}
      {fase === 'jogando' && (
        <View style={styles.progressWrap}>
          <View style={styles.progressBarOuter}>
            <Animated.View style={[styles.progressBarInner, { width: barraWidth }]} />
          </View>
          <Text style={styles.progressLabel}>{indice + 1} / {QUESTIONS_PER_LEVEL}</Text>
        </View>
      )}

      {fase === 'jogando' && (
        <Animated.View style={[styles.playWrap, { opacity: fadeQuestao }]}>
          {perguntaAtual && (
            <View style={styles.sequenceBox}>
              <Text style={styles.sequenceText}>
                {perguntaAtual.sequencia.join('   •   ')}   •   ?
              </Text>
            </View>
          )}

          <View style={styles.optionsGrid}>
            {perguntaAtual?.opcoes.map((op, idx) => (
              <TouchableOpacity
                key={idx}
                disabled={selected !== null}
                style={styles.optionBtn}
                onPress={() => handleResposta(op)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionTxt}>{op}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Cronômetro reposicionado aqui */}
          <View style={styles.timerBox}>
            <Feather name="clock" size={16} color="#ffd166" style={{ marginRight: 4 }} />
            <Text style={styles.timerText}>Tempo: {tempoTotal}s</Text>
          </View>

          <Text style={styles.hintTxt}>
            {dificuldade === 'facil'
              ? `Atinga ${STREAK_SKIP_FACIL} acertos seguidos para concluir antes.`
              : 'Mantenha constância e observe padrões.'}
          </Text>

          {!soundsLoaded && (
            <Text style={styles.loadingSnd}>Carregando sons...</Text>
          )}
        </Animated.View>
      )}

      {fase === 'resultado' && (
        <ResultadoNivel
          nivel={dificuldade}
          dados={resultados[dificuldade]}
          resultadosAll={resultados}
          onRetry={() => retryNivelGated(dificuldade)}      // <--- gating
          onNext={avancarNivel}                            // (se quiser gate por nível, troque por () => iniciarComGating(proxNivel))
          onMenu={() => navigation.goBack()}
        />
      )}

      {fase === 'final' && (
        <ResultadoFinal
          resultados={resultados}
            onRestart={restartAllGated}                    // <--- gating
          onMenu={() => navigation.goBack()}
        />
      )}

    {/* NOVO: Intro (janela sobreposta; impede ver a primeira sequência atrás) */}
      {showIntro && (
        <View style={styles.introOverlay} pointerEvents="box-none">
          <View style={styles.introCard} pointerEvents="auto">
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Feather name="zap" size={22} color="#ffd166" />
              <Text style={styles.introTitle}>Sequências</Text>
            </View>
            <Text style={styles.introText}>
              As sequências numéricas são usadas em diversos testes de QI por medirem o raciocínio indutivo, a memória de trabalho, a atenção e a velocidade de processamento.
              {'\n\n'}
              Como benefício: treina estratégia, foco e rapidez aplicadas a padrões — melhora o desempenho em testes de raciocínio e em tarefas que exigem detecção de regularidades.
              {'\n\n'}
              COMO JOGAR: assinale o número que melhor faz parte da sequência.
            </Text>

            <TouchableOpacity
              style={[
                styles.introBtn,
                startingGate && { opacity: 0.5 }
              ]}
              onPress={startFromIntro}
              disabled={startingGate}
              activeOpacity={0.9}
            >
              <Feather name="play-circle" size={22} color="#0a0f12" />
              <Text style={styles.introBtnTxt}>
                {startingGate ? '...' : 'Começar'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

// ---------------- STYLES ----------------
const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', paddingTop: 50, paddingHorizontal: 18 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14
  },
  


  appTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  topButtons: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    padding: 8,
    marginLeft: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14
  },
   introOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', zIndex: 10
  },
  introCard: {
    width: '90%',
    backgroundColor: 'rgba(20,25,35,0.96)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18, padding: 16
  },
  introTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  introText: { color: '#d1e8ff', fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  introBtn: {
    marginTop: 12, backgroundColor: '#00d3aa',
    paddingVertical: 10, borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center'
  },
  introBtnTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 16, marginLeft: 8 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 10
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  statusChipHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffd166',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 6
  },
  statusChipTxt: { color: '#d1e8ff', fontSize: 12, fontWeight: '500' },
  statusChipTxtHighlight: { color: '#0a0f12', fontSize: 12, fontWeight: '700' },

  progressWrap: { marginBottom: 12, width: '100%' },
  progressBarOuter: { width: '100%', height: 8, borderRadius: 4, backgroundColor: '#ffffff18', overflow: 'hidden' },
  progressBarInner: { height: '100%', backgroundColor: '#00d3aa' },
  progressLabel: { color: '#ffffff60', fontSize: 12, letterSpacing: 1, marginTop: 4, textAlign: 'right' },

  playWrap: { flex: 1, width: '100%' },

  sequenceBox: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 28
  },
  sequenceText: { fontSize: 30, color: '#fff', textAlign: 'center', fontWeight: '700', letterSpacing: 2 },

  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  optionBtn: {
    width: '48%',
    aspectRatio: 1.25,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  optionTxt: { color: '#fff', fontSize: 24, fontWeight: '600', letterSpacing: 1 },

  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16
  },
  timerText: { color: '#ffd166', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },

  hintTxt: { marginTop: 12, color: '#ffffff55', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  loadingSnd: { marginTop: 8, color: '#ffffff40', fontSize: 11, textAlign: 'center' },

  resultadoContainer: { width: '100%', alignItems: 'center', marginTop: 20 },
  resTitulo: { color: '#fff', fontSize: 30, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  resLinha: { color: '#d1e8ff', fontSize: 14, marginTop: 6 },
  resMensagem: { color: '#d1e8ff', fontSize: 15, marginTop: 22, textAlign: 'center', lineHeight: 20, marginBottom: 18, paddingHorizontal: 10 },
  starsRow: { flexDirection: 'row', marginTop: 18, marginBottom: 4, minHeight: 40 },

  factBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    width: '92%'
  },
  factTitle: {
    color: '#00d3aa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  factText: { color: '#d1e8ff', fontSize: 13, lineHeight: 18 },

  btPrim: { backgroundColor: '#00d3aa', width: '90%', paddingVertical: 14, borderRadius: 26, alignItems: 'center', marginTop: 6 },
  btSec: { backgroundColor: '#ffffff22', width: '90%', paddingVertical: 14, borderRadius: 26, alignItems: 'center', marginTop: 8 },
  btGhost: { paddingVertical: 10, marginTop: 12 },
  btTexto: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btGhostTxt: { color: '#ffffff70', fontSize: 14 },

  finalLinha: { flexDirection: 'row', justifyContent: 'space-between', width: '85%', paddingVertical: 8 },
  finalNivel: { color: '#fff', fontSize: 15, fontWeight: '500' },
  finalPercent: { color: '#fff', fontSize: 15, fontWeight: '700' },

  explicativo: {
    marginTop: 24,
    color: '#d1e8ff',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginBottom: 12
  },
  confettiLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none'
  }
});

function pickN(arr, n){
  const a = [...arr];
  for (let i = 0; i < n && i < a.length; i++){
    const r = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[r]] = [a[r], a[i]];
  }
  return a.slice(0, n);
}