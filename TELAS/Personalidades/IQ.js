import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Confetti } from '../../components/Confetti'; // 2 níveis: Personalidades -> TELAS -> components
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native'

import { supabase } from '../../supabaseClient';
import { personalities, dataIQ } from './dataProcessor';
import { updateRecord } from './records';
import { SafeScreen } from '../components/SafeScreen';
import { usePlano } from '../../planoContext'
import { tentarUsar } from '../../core/gatingLocal'
import { usePaywall } from '../../paywallContext'

const SOUND_START = require('../../assets/start.mp3');
const SOUND_VICTORY = require('../../assets/vitoria.mp3');
const SOUND_DEFEAT = require('../../assets/derrota.mp3');

const PASS_THRESHOLD = 0.7;
const DEFAULT_ROUNDS = 10;

const msToStr = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
const clean = (s) => String(s ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
const isKnown = (v) => {
  const s = clean(v).toLowerCase();
  return !!s && s !== 'desconhecido' && s !== 'nf' && s !== 'na' && s !== 'n/a';
};
const nameOf = (p) => clean(p?.person || p?.nome);
const arrify = (v) => Array.isArray(v) ? v : (isKnown(v) ? String(v).split(/[,;•|]/).map(s => clean(s)).filter(Boolean) : []);
const randFrom = (arr) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

// helpers para evitar repetição de informações
const stripLabel = (t) => String(t).replace(/^(Área:|Instituição:|País\/Região:|Curiosidade:|Conhecido por:|Prêmios:)\s*/i, '');
const normVal = (t) => clean(stripLabel(t)).toLowerCase();

const INFO_LINES_MAX = 3;

// base: apenas quem tem QI numérico e nome válido
function pickTrio(arr) {
  if (!arr || arr.length < 3) return null;
  const used = new Set();
  const out = [];
  let guard = 0;
  while (out.length < 3 && guard++ < 200) {
    const cand = arr[Math.floor(Math.random() * arr.length)];
    const nm = nameOf(cand);
    if (!nm || used.has(nm)) continue;
    used.add(nm);
    out.push(cand);
  }
  return out.length === 3 ? out : null;
}

// Curiosidade curta
function buildCuriosity(p) {
  const curListCsv = Array.isArray(p?.curiosidades_list)
    ? p.curiosidades_list.map(clean).filter(isKnown)
    : arrify(p?.curiosidades);
  const curPick = randFrom(curListCsv);
  if (isKnown(curPick)) return `Curiosidade: ${clean(curPick)}`;

  const premios = (Array.isArray(p?.premios_array) ? p.premios_array.map(x => clean(x?.award)).filter(isKnown) : []);
  const premio = premios.find(x => /nobel|pulitzer|fields|turing|oscar|grammy|pritzker|wolf/i.test(x)) || premios[0];
  const area = isKnown(p?.area_atuacao) ? clean(p.area_atuacao) : null;
  const insts = Array.isArray(p?.institutions_list) ? p.institutions_list.filter(isKnown).map(clean) : [];
  const inst = insts[0];

  if (premio) return `Prêmios: ${premio}`;
  if (area && inst) return `${area} • ${inst}`;
  if (area) return `${area}`;
  if (inst) return `Instituição: ${inst}`;
  return null;
}

// "Conhecido por"
function buildKnownFor(p) {
  const list = Array.isArray(p?.conhecido_por_list) ? p.conhecido_por_list : arrify(p?.known_for);
  const pick = randFrom(list);
  return isKnown(pick) ? `Conhecido por: ${clean(pick)}` : null;
}

// monta as linhas do card (sem redundância)
function pickInfoLines(p, max = INFO_LINES_MAX) {
  const area = isKnown(p?.area_atuacao) ? clean(p.area_atuacao) : null;
  const insts = Array.isArray(p?.institutions_list) ? p.institutions_list.filter(isKnown).map(clean) : [];
  const inst = insts[0] || null;
  const pais = isKnown(p?.pais_nascimento) ? clean(p.pais_nascimento)
             : (isKnown(p?.regiao_2020) ? clean(p.regiao_2020) : null);

  const curiosity = buildCuriosity(p);
  const knownFor = buildKnownFor(p);

  const candidates = [
    { key: 'curiosity', text: curiosity },
    { key: 'area', text: area ? `Área: ${area}` : null },
    { key: 'knownfor', text: knownFor },
    { key: 'instituicao', text: inst ? `Instituição: ${inst}` : null },
    { key: 'local', text: pais ? `País/Região: ${pais}` : null },
  ].filter(x => !!x.text);

  if (!candidates.length) return ['—'];

  const headerPool = candidates.filter(c => ['curiosity', 'area', 'knownfor'].includes(c.key));
  const included = [];
  const includedNorms = [];

  if (headerPool.length) {
    const firstPick = headerPool[Math.floor(Math.random() * headerPool.length)];
    included.push(firstPick);
    includedNorms.push(normVal(firstPick.text));
  } else {
    included.push(candidates[0]);
    includedNorms.push(normVal(candidates[0].text));
  }

  const remaining = candidates.filter(c => !included.find(i => i.key === c.key));
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  for (const cand of remaining) {
    if (included.length >= max) break;
    const n = normVal(cand.text);
    if (!includedNorms.some(it => it === n || it.includes(n) || n.includes(it))) {
      included.push(cand);
      includedNorms.push(n);
    }
  }

  return included.slice(0, max).map(x => x.text);
}

export default function IQ({ navigation, route }) {
  const { plano } = usePlano()              // <<< ADICIONADO
  const { open: openPaywall } = usePaywall()

  const insets = useSafeAreaInsets();

  const [config, setConfig] = useState({ rounds: DEFAULT_ROUNDS });
  const [showIntro, setShowIntro] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showMentor, setShowMentor] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false); // ADICIONADO

  const [trio, setTrio] = useState(null);
  const [infoLines, setInfoLines] = useState([]);
  const [index, setIndex] = useState(0);
  const [scorePoints, setScorePoints] = useState(0);
  const [selection, setSelection] = useState(null);
  const [tickMs, setTickMs] = useState(0);

  const startRef = useRef(Date.now());
  const tickRef = useRef(null);
  const timesMsRef = useRef([]);
  const correctnessRef = useRef([]);
  const sessionStartRef = useRef(0);
  const soundRef = useRef(null);

  const [bestCorrectMs, setBestCorrectMs] = useState(null);
  const [bestRun, setBestRun] = useState({ percent: null, timeSec: null, rounds: null });

  // Usuário autenticado (para salvar resultado)
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      setAuthUser(error ? null : data?.user ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);
  const displayName = (u) => {
    const m = u?.user_metadata || {};
    return m.nickname || m.full_name || u?.email?.split('@')[0] || 'Você';
  };

  useEffect(() => {
    (async () => {
      try {
        const c = await AsyncStorage.getItem('iq:config');
        if (c) setConfig(JSON.parse(c));
        const bc = await AsyncStorage.getItem('iq:bestCorrectMs');
        if (bc) setBestCorrectMs(Number(bc));
        const br = await AsyncStorage.getItem('iq:bestRun');
        if (br) setBestRun(JSON.parse(br));
      } catch {}
    })();
  }, []);

  useEffect(() => () => soundRef.current?.unloadAsync(), []);

  const playSound = useCallback(async (src) => {
    try {
      const { sound } = await Audio.Sound.createAsync(src, { volume: 0.75 });
      soundRef.current = sound;
      await sound.playAsync();
    } catch {}
  }, []);
  const startTimer = useCallback(() => {
    startRef.current = Date.now();
    setTickMs(0);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setTickMs(Date.now() - startRef.current), 60);
  }, []);
  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const newQuestion = useCallback(() => {
    setSelection(null);
    const tr = pickTrio(dataIQ);
    setTrio(tr);
    setInfoLines(tr ? tr.map(p => pickInfoLines(p)) : []);
    playSound(SOUND_START);
    startTimer();
  }, [playSound, startTimer]);

  const startGame = useCallback(() => {
    timesMsRef.current = [];
    correctnessRef.current = [];
    sessionStartRef.current = Date.now();
    setIndex(0);
    setScorePoints(0);
    setShowIntro(false);
    setShowResult(false);
    newQuestion();
  }, [newQuestion]);

  const iniciarIQ = useCallback(async () => {
    console.log('[IQ] iniciarIQ plano=', plano);
    const r = await tentarUsar('IQ', plano);
    console.log('[IQ] resultado tentarUsar', r);
    if (!r.ok) {
      if (r.erro === 'nao_logado') { navigation.navigate('Login'); return; }
      if (r.erro === 'limite') { openPaywall(); return; }
      if (r.erro === 'compra_unica_necessaria') { openPaywall('STF'); return; }
      return;
    }
    startGame();
  }, [plano, navigation, startGame, openPaywall]);

  useEffect(() => {
    console.log('[IQ] mount, personalities len', personalities.length)
  }, []);

  // Persistir número de rounds (opcional)
  const saveRounds = useCallback(async (val) => {
    setConfig(c => ({ ...c, rounds: val }))
    try {
      await AsyncStorage.setItem('iq:rounds', String(val))
    } catch {}
  }, [])

  // Carregar rounds salvos na montagem (opcional)
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('iq:rounds')
        if (saved) setConfig(c => ({ ...c, rounds: parseInt(saved,10) || c.rounds }))
      } catch {}
    })()
  }, [])

  const mentorInfo = useMemo(() => {
    // Evita crash se arrays ainda vazias
    const lastN = 5
    const corr = correctnessRef.current
    const times = timesMsRef.current
    const sliceCorr = corr.slice(-lastN)
    const sliceTimes = times.slice(-lastN)
    const acc = sliceCorr.length ? Math.round(sliceCorr.filter(v=>v).length / sliceCorr.length * 100) : 0
    const avg = sliceTimes.length ? Math.round(sliceTimes.reduce((a,b)=>a+b,0) / sliceTimes.length) : 0
    let msg
    if (acc >= 80) msg = 'Excelente ritmo!'
    else if (acc >= 60) msg = 'Bom, tente subir mais.'
    else msg = 'Observe melhor as pistas.'
    return { acc, avg, msg }
  }, [index]) // recalcula a cada nova questão

  if (showIntro) {
    return (
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.introCenter}>
          <View style={styles.introCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginBottom: 8 }}>
              <Feather name="trending-up" size={22} color="#ffd166" />
              <Text style={styles.introTitle}>Quem tem o QI mais alto?</Text>
            </View>
            <Text style={styles.introText}>
              Três personalidades serão mostradas. Escolha quem possui o maior QI. Se houver empate no maior QI, qualquer uma das empatadas vale.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={iniciarIQ} activeOpacity={0.9}>
              <Feather name="play-circle" size={20} color="#0a0f12" />
              <Text style={styles.primaryBtnTxt}>Começar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <SettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          rounds={config.rounds}
          onRoundsChange={saveRounds}
          bestCorrectMs={bestCorrectMs}
          bestRun={bestRun}
        />
      </LinearGradient>
    );
  }

  if (!trio) {
    return <ActivityIndicator size="large" color="#fff" style={{ flex: 1, backgroundColor: '#0f2027' }} />;
  }

  const answered = index + 1;
  const percentInt = Math.round((scorePoints / config.rounds) * 100);

  const maxQI = Math.max(...trio.map(p => +p.QI_calculado));
  const winners = new Set(trio.filter(p => +p.QI_calculado === maxQI).map(p => nameOf(p)));

  const onSelect = (choice) => {
    if (selection) return;
    const elapsed = Date.now() - startRef.current;
    stopTimer();

    const isCorrect = winners.has(nameOf(choice));

    timesMsRef.current.push(elapsed);
    correctnessRef.current.push(isCorrect);

    if (isCorrect) {
      setScorePoints(s => s + 1);
      (async () => {
        try {
          if (bestCorrectMs == null || elapsed < bestCorrectMs) {
            setBestCorrectMs(elapsed);
            await AsyncStorage.setItem('iq:bestCorrectMs', String(elapsed));
          }
        } catch {}
      })();
      playSound(SOUND_VICTORY);
    } else {
      playSound(SOUND_DEFEAT);
    }
    setSelection(nameOf(choice));

    updateRecord('iq', Math.floor(scorePoints + (isCorrect ? 1 : 0)));
  };

  const next = () => {
    const answeredNow = index + 1;
    if (answeredNow % 5 === 0 && answeredNow < config.rounds) {
      setShowMentor(true);
      return;
    }
    if (answeredNow >= config.rounds) {
      finishSession();
    } else {
      setIndex(i => i + 1);
      newQuestion();
    }
  };

  const closeMentor = () => {
    setShowMentor(false);
    if (index + 1 >= config.rounds) finishSession();
    else {
      setIndex(i => i + 1);
      newQuestion();
    }
  };

  const finishSession = async () => {
    const totalMs = Date.now() - sessionStartRef.current;
    setShowResult(true);
    const percentVal = scorePoints / config.rounds;

    // Salvar melhor run local
    try {
      const prev = bestRun && bestRun.percent != null ? bestRun : { percent: 0, timeSec: Infinity, rounds: 0 };
      const current = { percent: percentVal, timeSec: Math.round(totalMs / 1000), rounds: config.rounds };
      const better = (percentVal > (prev.percent ?? 0)) ||
                     (percentVal === (prev.percent ?? 0) && current.timeSec < (prev.timeSec ?? Infinity));
      if (better) {
        setBestRun(current);
        await AsyncStorage.setItem('iq:bestRun', JSON.stringify(current));
      }
    } catch {}

    // Salvar no Supabase (se autenticado)
    if (authUser) {
      const basePayload = {
        user_name: displayName(authUser),
        percent: Math.max(0, Math.min(100, percentInt)),
        score: scorePoints,
        time_ms: Math.round(totalMs),
        rounds: config.rounds,
      };
      try {
        // tenta com user_id (se a coluna existir no schema)
        const payload = { ...basePayload, user_id: authUser.id };
        let { error } = await supabase.from('personalities_iq_results').insert(payload);
        if (error) {
          // tenta sem user_id
          const { user_id, ...rest } = payload;
          ({ error } = await supabase.from('personalities_iq_results').insert(rest));
          if (error && /user_name/i.test(error.message)) {
            const { user_name, ...rest2 } = rest;
            await supabase.from('personalities_iq_results').insert(rest2);
          }
        }
      } catch {}
    }
  };

  return (
    <SafeScreen edges={['left','right']} style={styles.root}>
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Feather name="trending-up" size={18} color="#ffd166" />
            <Text style={styles.title}>QI mais alto</Text>
          </View>

          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
            <Feather name="settings" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Chips */}
        <View style={styles.chipsRow}>
          <View style={styles.chip}><Feather name="list" size={14} color="#00d3aa" /><Text style={styles.chipTxt}>{answered}/{config.rounds}</Text></View>
          <View style={styles.chip}><Feather name="award" size={14} color="#ffd166" /><Text style={styles.chipTxt}>Pontos: {scorePoints}</Text></View>
          <View style={styles.chip}><Feather name="clock" size={14} color="#9ad8ff" /><Text style={styles.chipTxt}>Tempo: {(tickMs/1000).toFixed(2)}s</Text></View>
        </View>

        {/* Pergunta */}
        <Text style={styles.question}>Quem tem o maior QI?</Text>

        <SafeScreen.Scroll
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, gap: 14 }}
          extraBottom={Platform.OS === 'ios' ? 56 : 96}
        >
          {/* Cards */}
          <View style={styles.content}>
            {trio.map((p, idx) => {
              const nm = nameOf(p);
              const isSelected = selection === nm;
              let styleBtn = styles.optionCard;
              if (selection && isSelected && winners.has(nm)) styleBtn = styles.correctCard;
              if (selection && isSelected && !winners.has(nm)) styleBtn = styles.incorrectCard;

              const lines = infoLines[idx] || [];

              return (
                <TouchableOpacity
                  key={nm}
                  style={styleBtn}
                  onPress={() => onSelect(p)}
                  disabled={!!selection}
                  activeOpacity={0.9}
                >
                  <Text style={styles.optionName}>{nm}</Text>
                  {lines.map((t, i) => (
                    <Text key={i} style={styles.optionSubtitle} numberOfLines={2}>{t}</Text>
                  ))}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Botão Próxima */}
          <View style={styles.nextWrap}>
            {selection ? (
              <TouchableOpacity style={styles.nextButton} onPress={next} activeOpacity={0.9}>
                <Text style={styles.nextButtonText}>{(index + 1) >= config.rounds ? 'Finalizar' : 'Próxima'}</Text>
                <Feather name="play-circle" size={18} color="#0a0f12" />
              </TouchableOpacity>
            ) : null}
          </View>
        </SafeScreen.Scroll>

        {/* Mentor */}
        <Modal visible={showMentor} transparent animationType="fade" onRequestClose={closeMentor}>
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Mentor</Text>
              <Text style={styles.modalMsg}>{mentorInfo.msg}</Text>
              <View style={styles.resultsGrid}>
                <View style={styles.resItem}><Feather name="percent" size={18} color="#9ad8ff" /><Text style={styles.resVal}>{mentorInfo.acc}%</Text><Text style={styles.resKey}>Precisão (últimas 5)</Text></View>
                <View style={styles.resItem}><Feather name="clock" size={18} color="#ffd166" /><Text style={styles.resVal}>{msToStr(mentorInfo.avg)}</Text><Text style={styles.resKey}>Tempo médio</Text></View>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={closeMentor}>
                <Text style={styles.primaryBtnTxt}>Continuar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Resultado */}
        <Modal visible={showResult} transparent animationType="fade" onRequestClose={() => setShowResult(false)}>
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              {showConfetti && (
                <Confetti count={140} duration={4500} />
              )}
              <Text style={styles.modalTitle}>
                {scorePoints / config.rounds >= PASS_THRESHOLD ? 'Parabéns!' : 'Resultado'}
              </Text>
              <View style={styles.resultsGrid}>
                <View style={styles.resItem}><Feather name="award" size={18} color="#ffd166" /><Text style={styles.resVal}>{scorePoints} / {config.rounds}</Text><Text style={styles.resKey}>Pontos</Text></View>
                <View style={styles.resItem}><Feather name="percent" size={18} color="#9ad8ff" /><Text style={styles.resVal}>{percentInt}%</Text><Text style={styles.resKey}>Aproveitamento</Text></View>
                <View style={styles.resItem}><Feather name="zap" size={18} color="#00d3aa" /><Text style={styles.resVal}>{msToStr(bestCorrectMs)}</Text><Text style={styles.resKey}>Resposta mais rápida</Text></View>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={startGame}><Text style={styles.primaryBtnTxt}>Reiniciar</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setShowResult(false); navigation.goBack(); }}><Text style={styles.secondaryBtnTxt}>Menu</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Configurações */}
        <SettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          rounds={config.rounds}
          onRoundsChange={saveRounds}
          bestCorrectMs={bestCorrectMs}
          bestRun={bestRun}
        />
      </LinearGradient>
    </SafeScreen>
  );
}

function SettingsModal({ visible, onClose, rounds, onRoundsChange, bestCorrectMs, bestRun }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Configurações</Text>

          <Text style={styles.section}>Rodadas por partida</Text>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={5}
            maximumValue={50}
            step={1}
            value={rounds ?? DEFAULT_ROUNDS}
            onValueChange={onRoundsChange}
            minimumTrackTintColor="#00d3aa"
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="#00d3aa"
          />
          <Text style={styles.sliderValue}>{rounds ?? DEFAULT_ROUNDS}</Text>

          <Text style={styles.section}>Seus recordes</Text>
          <View style={styles.resultsGrid}>
            <View style={styles.resItem}><Feather name="zap" size={18} color="#00d3aa" /><Text style={styles.resVal}>{msToStr(bestCorrectMs)}</Text><Text style={styles.resKey}>Resposta correta mais rápida</Text></View>
            <View style={styles.resItem}><Feather name="clock" size={18} color="#ffd166" /><Text style={styles.resVal}>{bestRun?.timeSec != null ? `${bestRun.timeSec}s` : '—'}</Text><Text style={styles.resKey}>Partida mais rápida</Text></View>
            <View style={styles.resItem}><Feather name="percent" size={18} color="#9ad8ff" /><Text style={styles.resVal}>{bestRun?.percent != null ? `${Math.round(bestRun.percent*100)}%` : '—'}</Text><Text style={styles.resKey}>Melhor % de acertos</Text></View>
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}><Text style={styles.secondaryBtnTxt}>Fechar</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },

  header: { paddingTop: 0, paddingBottom: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { padding: 6 },
  iconBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14 },

  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },

  chipsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipTxt: { color: '#d1e8ff', fontSize: 12, fontWeight: '600' },

  question: { color: '#ffffff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 6, marginBottom: 8 },

  content: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  optionCard: {
    backgroundColor: '#232526',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#ffffff30',
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctCard: {
    backgroundColor: '#00d3aa',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#fff',
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incorrectCard: {
    backgroundColor: '#e74c3c',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#fff',
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionName: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  optionSubtitle: { color: '#9fe870', marginTop: 8, textAlign: 'center', fontSize: 14, lineHeight: 18 },

  nextWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 18 },
  nextButton: { backgroundColor: '#ffd166', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextButtonText: { color: '#0a0f12', fontSize: 16, fontWeight: '800' },

  // Intro / Modais
  introCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  introCard: { width: '92%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 18 },
  introTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  introText: { color: '#d1e8ff', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', backgroundColor: '#101828', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalTitle: { color: '#fff', fontWeight: '900', fontSize: 20, marginBottom: 8, alignSelf: 'center' },
  modalMsg: { color: '#d1e8ff', fontSize: 14, textAlign: 'center', marginBottom: 10 },
  resultsGrid: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 6, flexWrap: 'wrap', gap: 10 },
  resItem: { alignItems: 'center', width: '30%' },
  resKey: { color: '#b2c7d3', fontSize: 11, marginTop: 2, textAlign: 'center' },
  resVal: { color: '#fff', fontWeight: '900', fontSize: 16, marginTop: 4, textAlign: 'center' },

  primaryBtn: { backgroundColor: '#00d3aa', paddingVertical: 12, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtnTxt: { color: '#0a0f12', fontWeight: '800' },
  secondaryBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  secondaryBtnTxt: { color: '#fff', fontWeight: '700' },

  section: { color: '#b2c7d3', fontSize: 12, marginTop: 12, marginBottom: 6 },
  sliderValue: { color: '#fff', fontSize: 14, alignSelf: 'center', marginBottom: 8 },
});