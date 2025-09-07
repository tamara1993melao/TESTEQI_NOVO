import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Confetti } from '../../components/Confetti'; // ADICIONE

import { personalities } from './dataProcessor';
import { updateRecord } from './records';
import { supabase } from '../../supabaseClient'; // ADICIONE (já estava)
// >>> GATING (novos imports)
import { usePlano } from '../../planoContext';
import { tentarUsar } from '../../core/gatingLocal';
import { usePaywall } from '../../paywallContext';

import { SafeScreen } from '../components/SafeScreen'; // ALTERADO
import { useSafeAreaInsets } from 'react-native-safe-area-context'; // ALTERADO
import { Platform } from 'react-native'; // ALTERADO

const SOUND_START = require('../../assets/start.mp3');
const SOUND_VICTORY = require('../../assets/vitoria.mp3');
const SOUND_DEFEAT = require('../../assets/derrota.mp3');

const PASS_THRESHOLD = 0.7;
const DEFAULT_ROUNDS = 10;

// Forçar alvo por período (ex.: 1800–1950)
const MODERN_EVERY = 1;          // 1 = toda rodada; 2 = a cada 2; 5 = a cada 5
const MODERN_YEAR_MIN = 1800;
const MODERN_YEAR_MAX = 1950;

// Forçar índice alto a cada N rodadas
const HIGH_INDEX_EVERY = 2;      // a cada 2 rodadas (2, 4, 6, ...)
const HIGH_INDEX_MIN = 50;       // index > 50

const isModernBirth = (p) =>
  typeof p?.Nascimento === 'number' &&
  p.Nascimento >= MODERN_YEAR_MIN &&
  p.Nascimento <= MODERN_YEAR_MAX;

const isHighIndex = (p) => Number(p?.index) > HIGH_INDEX_MIN;

function popFromDeck(deck, list, predicate) {
  for (let i = deck.length - 1; i >= 0; i--) {
    const idx = deck[i];
    if (predicate(list[idx])) {
      deck.splice(i, 1);
      return idx;
    }
  }
  return deck.pop();
}

// utils
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const msToStr = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
const randOf = (arr, def = '') => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : def);

// NOVO: nome visível com fallback (nunca vazio se houver person)
const nomeOf = (p) => {
  const n = String(p?.nome ?? '').trim();
  if (n) return n;
  return String(p?.person ?? '').trim();
};
// Identificador persistente
const personKey = (p) => String(p?.id_person ?? p?.nome ?? p?.person ?? '');

// Pesos de seleção de pista
const HINT_WEIGHTS = {
  area_atuacao: 8.0,
  sub_area_atuacao: 5.2,
  pIQ_HM_estimado: 1.6,
  QI_calculado: 2.4,
  Nascimento: 2.8,
  Morte: 1.2,
  Floresceu: 1.1,
  pais_2020: 6.6,
  regiao_2020: 1.4,
  cidade_2020: 1.2,
  pais_nascimento: 1.7,
  pais_trabalhou: 4.5,
  etnia: 2.1,
  genero: 0.1,
  familia: 5.9,
  imigrante: 5.8,
  curiosidades: 10.9,
  nobel: 9.0
};

// validações
const validText = (v) => {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  const INVALID = new Set(['nf', 'n/a', 'nan', '-', '—', 'na', 'null', 'desconhecido', 'não informado', 'sem informação']);
  if (INVALID.has(low)) return false;
  return true;
};
const validNum = (v) => {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (/[a-z]/i.test(s) || /[–—]/.test(s)) return false;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n);
};

// rótulos
function labelFor(key, val) {
  switch (key) {
    case 'area_atuacao': return `Atuou principalmente em ${val}`;
    case 'sub_area_atuacao': return `Teve como subárea de atuação ${val}`;
    case 'QI_calculado': return `QI estimado é ${val}`;
    case 'pIQ_HM_estimado': return `QI estimado é ${val}`;
    case 'Nascimento': return `Nasceu no ano de ${val}`;
    case 'Morte': return `Falecimento: ${val}`;
    case 'Floresceu': return `Destacou-se por volta de ${val}`;
    case 'pais_2020': return `Nasceu no país que atualmente é ${val}`;
    case 'regiao_2020': return `Nasceu na Região que atualmente é ${val}`;
    case 'cidade_2020': return `Nasceu na atual cidade de ${val}`;
    case 'pais_nascimento': return `Nascimento no país de ${val}`;
    case 'pais_trabalhou': return `País de principal atuação foi ${val}`;
    case 'etnia': return `Sua etnia é ${val}`;
    case 'genero': return `Seu gênero é ${val}`;
    case 'familia': return `Veio de família ${val}`;
    case 'imigrante': return `Foi imigrante`;
    case 'curiosidades': return `${val}`;
    case 'nobel': return `Laureado com o Nobel: ${val}`;
    default: return `${key}: ${val}`;
  }
}

// seleção ponderada
function weightedPick(items) {
  const total = items.reduce((acc, it) => acc + (it.w || 1), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= (it.w || 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1] || null;
}

// helper QI
function chooseFrom(p, keys, used) {
  const cands = [];
  for (const key of keys) {
    if (used.has(key)) continue;

    if (key === 'QI') {
      if (used.has('QI') || (used.has('pIQ_HM_estimado') && used.has('QI_calculado'))) continue;
      const hmOk = !used.has('pIQ_HM_estimado') && validNum(p['pIQ_HM_estimado']);
      const calcOk = !used.has('QI_calculado') && validNum(p['QI_calculado']);
      if (hmOk) cands.push({ key: 'QI_HM', label: labelFor('pIQ_HM_estimado', p['pIQ_HM_estimado']), w: HINT_WEIGHTS.pIQ_HM_estimado ?? 1 });
      if (calcOk) cands.push({ key: 'QI_CALC', label: labelFor('QI_calculado', p['QI_calculado']), w: HINT_WEIGHTS.QI_calculado ?? 1 });
    } else {
      const isNum = ['Nascimento', 'Morte', 'Floresceu'].includes(key);
      const isValid = isNum ? validNum(p[key]) : validText(p[key]);
      if (isValid) cands.push({ key, label: labelFor(key, p[key]), w: HINT_WEIGHTS[key] ?? 1 });
    }
  }
  if (!cands.length) return null;
  const picked = weightedPick(cands);
  if (!picked) return null;
  if (picked.key === 'QI_HM') { used.add('QI'); used.add('pIQ_HM_estimado'); }
  else if (picked.key === 'QI_CALC') { used.add('QI'); used.add('QI_calculado'); }
  else { used.add(picked.key); }
  return picked.label;
}

// Reordena visíveis para garantir Área primeiro (se necessário)
function ensureAreaFirst(hints, p) {
  const areaRaw = p?.area_atuacao != null ? String(p.area_atuacao).trim() : '';
  if (!areaRaw) return hints;
  const areaLabel = labelFor('area_atuacao', areaRaw);
  const idx = hints.indexOf(areaLabel);
  if (idx === 0) return hints;
  if (idx > 0) {
    const copy = hints.slice();
    copy.splice(idx, 1);
    copy.unshift(areaLabel);
    return copy;
  }
  return [areaLabel, ...hints];
}

// Constrói 3 pistas visíveis + 2 candidatas secretas (sem frases)
function buildHintsStructured(p) {
  const used = new Set();
  let h1 = null, h2 = null, h3 = null, h4 = null, h5 = null;

  // H1: área (ou subárea)
  const areaRaw = p?.area_atuacao != null ? String(p.area_atuacao).trim() : '';
  if (areaRaw) { h1 = labelFor('area_atuacao', areaRaw); used.add('area_atuacao'); }
  else { h1 = chooseFrom(p, ['sub_area_atuacao'], used); }

  // H2: período
  h2 = chooseFrom(p, ['Nascimento', 'Morte', 'Floresceu','curiosidades','nobel'], used);

  // H3: geografia (sem curiosidades)
  h3 = chooseFrom(p, ['pais_2020','nobel', 'pais_nascimento', 'pais_trabalhou', 'etnia','curiosidades'], used);

  // H4/H5: candidatas para secretas (sem curiosidades)
  h4 = chooseFrom(p, ['sub_area_atuacao', 'QI', 'etnia', 'familia','nobel'], used);
  h5 = chooseFrom(p, ['pais_2020', 'familia', 'sub_area_atuacao', 'pais_trabalhou', 'etnia','nobel','area_atuacao'], used);

  // Visíveis
  const visible = [h1, h2, h3].filter(Boolean);
  const extras = [h4, h5].filter(Boolean);
  while (visible.length < 3 && extras.length) visible.push(extras.shift());

  // Secretas 1 e 2 (apenas o que sobrou)
  const visibleSet = new Set(visible);
  const secretCandidates = [];
  if (h4 && !visibleSet.has(h4)) secretCandidates.push(h4);
  if (h5 && !visibleSet.has(h5)) secretCandidates.push(h5);

  const secrets = [secretCandidates[0], secretCandidates[1]].filter(Boolean);
  return { hints: visible, secrets };
}

// 5 opções: 1 correta + 3 distratoras + 1 do mesmo país
// 5 opções: 1 correta + 3 distratoras + 1 do mesmo país
function makeRound(all, forcedTarget = null) {
  if (!all || all.length < 6) return null;
  const target = forcedTarget || all[Math.floor(Math.random() * all.length)];

 // tira o alvo e qualquer registro sem nome utilizável
  const poolExcludingTarget = all.filter(x => {
    const nx = nomeOf(x);
    const nt = nomeOf(target);
    return nx && nt && nx !== nt;
  });

  // 1) alternativa do mesmo país (obrigatória)
  const sameCountryPool = poolExcludingTarget.filter(
    x => validText(x.pais_nascimento) && validText(target.pais_nascimento) && x.pais_nascimento === target.pais_nascimento
  );
  const sameCountry = sameCountryPool.length ? sameCountryPool[Math.floor(Math.random() * sameCountryPool.length)] : null;

  // 2) 3 distratores (área/região quando possível)
  const thematics = poolExcludingTarget.filter(
    x => x !== sameCountry && (
      (validText(x.area_atuacao) && x.area_atuacao === target.area_atuacao) ||
      (validText(x.regiao_2020) && x.regiao_2020 === target.regiao_2020)
    )
  );
  const generic = poolExcludingTarget.filter(x => x !== sameCountry);
  const baseDistractors = thematics.length >= 3 ? thematics : generic;
  const distractors = [];
  for (const cand of shuffle(baseDistractors)) {
    if (distractors.length >= 3) break;
    if (!cand) continue;
    const nc = nomeOf(cand);
    if (!nc) continue;
    if (nc === nomeOf(target)) continue;
    if (sameCountry && nc === nomeOf(sameCountry)) continue;
    if (distractors.find(d => nomeOf(d) === nc)) continue;
    distractors.push(cand);
  }
  while (distractors.length < 3) {
     const cand = generic[Math.floor(Math.random() * generic.length)];
    if (!cand) break;
    const nc = nomeOf(cand);
    if (!nc) continue;
    if (nc === nomeOf(target)) continue;
    if (sameCountry && nc === nomeOf(sameCountry)) continue;
    if (distractors.find(d => nomeOf(d) === nc)) continue;
    distractors.push(cand);
  }

  const requiredCountryOption = sameCountry || distractors.pop();
  const options = shuffle([target, ...distractors, requiredCountryOption]).slice(0, 5);

  const { hints, secrets } = buildHintsStructured(target);
  return { target, options, hints, secrets };
}

const EDU_FACTS = [
  'Reconhecer área + época acelera a inferência do nome.',
  'Ancore pela nacionalidade e refine pela subárea.',
  'Espaçar treinos aumenta retenção de padrões biográficos.',
  'Velocidade vem da prática focada nas pistas fortes.',
  'Compare pistas fortes (Área/QI) antes das fracas.',
];

// Medal helper
const medalInfo = (p) => {
  if (p >= 95) return { icon: 'award', color: '#f1c40f', label: 'Excelente' };
  if (p >= 85) return { icon: 'zap', color: '#9ad8ff', label: 'Rápido' };
  if (p >= 70) return { icon: 'star', color: '#cd7f32', label: 'Bom' };
  return { icon: 'trending-up', color: '#8895a7', label: 'Em progresso' };
};

// Helper para nome consistente (nickname > name > email prefix > 'Convidado')
async function fetchDisplayName() {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return 'Convidado';
    const meta = u.user_metadata || {};
    const { data: prof } = await supabase
      .from('profiles')
      .select('nickname,name')
      .eq('id', u.id)
      .maybeSingle();
    return (
      (prof?.nickname || '').trim() ||
      (prof?.name || '').trim() ||
      (meta.nickname || '').trim() ||
      (meta.full_name || meta.name || '').trim() ||
      (u.email ? u.email.split('@')[0] : '') ||
      'Convidado'
    ).slice(0,80);
  } catch {
    return 'Convidado';
  }
}

// ADICIONE: salva resultado da sessão no Supabase
async function saveAdivinheResult({ score, percent, time_ms }) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    const user_name = await fetchDisplayName();

    const payload = { user_id: uid, user_name, score, percent, time_ms };
    console.log('[adivinhe] insert payload', payload);

    const { error } = await supabase
      .from('personalities_adivinhe_results')
      .insert(payload);

    if (error) {
      console.log('[adivinhe] insert ERROR', error);
      return false;
    }

    // Snapshot local (para Records localKey)
    try {
      await AsyncStorage.setItem('adivinhe:last', JSON.stringify({
        user_name, score, percent, time_ms, created_at: new Date().toISOString()
      }));
    } catch {}
    return true;
  } catch (e) {
    console.log('[adivinhe] insert exception', e?.message || e);
    return false;
  }
}

export default function Adivinhe({ navigation }) {
  // Insets para topo dinâmico
  const insets = useSafeAreaInsets(); // ALTERADO

  // sessão
  const [config, setConfig] = useState({ rounds: DEFAULT_ROUNDS, difficulty: 'dificil' });
  const [showIntro, setShowIntro] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showMentor, setShowMentor] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const [round, setRound] = useState(null);
  const [index, setIndex] = useState(0);
  const [scorePoints, setScorePoints] = useState(0); // 1.0 / 0.5 / 0.25 / 0.125
  const [correctCount, setCorrectCount] = useState(0);
  const [selection, setSelection] = useState(null);

  // Pistas secretas
  const [secretUses, setSecretUses] = useState(0);
  const [revealedSecrets, setRevealedSecrets] = useState([]);

  // timer por questão
  const [tickMs, setTickMs] = useState(0);
  const startRef = useRef(Date.now());
  const tickRef = useRef(null);
  const timesMsRef = useRef([]);
  const correctnessRef = useRef([]);
  const sessionStartRef = useRef(0);

  // sons
  const soundRef = useRef(null);

  // recordes
  const [bestCorrectMs, setBestCorrectMs] = useState(null);
  const [bestRun, setBestRun] = useState({ percent: null, timeSec: null, rounds: null });

  // deck de índices
  const deckRef = useRef([]);

  // pessoas já vistas (persistente)
  const seenRef = useRef(new Set());

  // carregar config/recordes
  useEffect(() => {
    (async () => {
      try {
        const c = await AsyncStorage.getItem('adiv:config');
        if (c) {
          const parsed = JSON.parse(c);
          setConfig(prev => ({
            rounds: parsed?.rounds ?? DEFAULT_ROUNDS,
            difficulty: parsed?.difficulty ?? 'dificil'
          }));
        }
        const bc = await AsyncStorage.getItem('adiv:bestCorrectMs');
        if (bc) setBestCorrectMs(Number(bc));
        const br = await AsyncStorage.getItem('adiv:bestRun');
        if (br) setBestRun(JSON.parse(br));
      } catch {}
    })();
  }, []);

  // carrega conjunto de pessoas já mostradas
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('adiv:seen');
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) seenRef.current = new Set(arr);
        }
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

  // dificuldade
  const indexNum = (p) => {
    const n = Number(p?.index);
    return Number.isFinite(n) ? n : null;
  };
  const passDifficulty = (p) => {
    return (config?.difficulty === 'facil')
      ? (indexNum(p) != null && indexNum(p) > 20)
      : true;
  };

  // cronômetro
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

  // nova rodada
  const newQuestion = useCallback(() => {
    setSelection(null);
    setSecretUses(0);
    setRevealedSecrets([]);

    // Reabastece deck com "não vistos" que passam dificuldade
    if (!deckRef.current || deckRef.current.length === 0) {
      const seen = seenRef.current;
      const allIdx = personalities.map((_, i) => i);
      const unseenIdx = allIdx.filter(i => {
        const p = personalities[i];
        const k = personKey(p);
            return k && !seen.has(k) && passDifficulty(p);
        });
        deckRef.current = shuffle(unseenIdx);

        if (deckRef.current.length === 0) {
          seenRef.current = new Set();
          try { AsyncStorage.removeItem('adiv:seen'); } catch {}
          const filteredAll = allIdx.filter(i => passDifficulty(personalities[i])); // FIX
          deckRef.current = shuffle(filteredAll.length ? filteredAll : allIdx);
        }
      }

    // Regras especiais
    const needModern = (MODERN_EVERY > 0) && ((index % MODERN_EVERY) === (MODERN_EVERY - 1));
    const needHighIndex = (HIGH_INDEX_EVERY > 0) && ((index + 1) % HIGH_INDEX_EVERY === 0);

    let idx;
    if (needModern || needHighIndex) {
      const predicate =
        (needModern && needHighIndex)
          ? (p) => isModernBirth(p) && isHighIndex(p)
          : needModern
            ? isModernBirth
            : isHighIndex;
      idx = popFromDeck(deckRef.current, personalities, predicate);
    } else {
      idx = deckRef.current.pop();
    }

    const target = personalities[idx];

    // Marca como visto
    const k = personKey(target);
    if (k) {
      const set = seenRef.current;
      if (!set.has(k)) {
        set.add(k);
        try { AsyncStorage.setItem('adivinhe:seen', JSON.stringify(Array.from(set))); } catch {}
      }
    }

    setRound(makeRound(personalities, target));
    playSound(SOUND_START);
    startTimer();
  }, [playSound, startTimer, index, config?.difficulty]);

  // novo jogo
  const startGame = useCallback(() => {
    timesMsRef.current = [];
    correctnessRef.current = [];
    sessionStartRef.current = Date.now();
    setIndex(0);
    setScorePoints(0);
    setCorrectCount(0);
    setShowIntro(false);
    setShowResult(false);
    newQuestion();
  }, [newQuestion]);

  // >>> Função de início com verificação de limite (igual ao IQ)
  const iniciarAdivinhe = useCallback(async () => {
    console.log('[ADIVINHE] iniciarAdivinhe plano=', plano);
    const r = await tentarUsar('ADIVINHE', plano);
    console.log('[ADIVINHE] resultado tentarUsar', r);
    if (!r.ok) {
      if (r.erro === 'nao_logado') { navigation.navigate('Login'); return; }
      if (r.erro === 'limite') { openPaywall(); return; }
      if (r.erro === 'compra_unica_necessaria') { openPaywall('ADIVINHE'); return; }
      // codigo_desconhecido → simplesmente não inicia (ou poderia chamar startGame se quiser fallback)
      return;
    }
    startGame();
  }, [plano, navigation, openPaywall, startGame]);

  const saveRounds = async (val) => {
    const v = Math.max(5, Math.min(50, Math.round(val)));
    const next = { rounds: v, difficulty: config?.difficulty ?? 'dificil' };
    setConfig(next);
    try { await AsyncStorage.setItem('adiv:config', JSON.stringify(next)); } catch {}
  };

  const saveDifficulty = async (level) => {
    const next = { rounds: config?.rounds ?? DEFAULT_ROUNDS, difficulty: level };
    setConfig(next);
    deckRef.current = []; // aplicar filtro imediatamente
    try { await AsyncStorage.setItem('adiv:config', JSON.stringify(next)); } catch {}
  };

  // revelar pistas secretas (até 3; a 3ª só com curiosidades)
  const revealSecret = () => {
    if (!round) return;
    const used = revealedSecrets.length;
    // Se o botão aparecer, sabemos que há algo disponível
    const already = new Set([...round.hints, ...revealedSecrets]);

    const buildFallback = () => {
      const ordem = [
        'sub_area_atuacao','QI_calculado','pIQ_HM_estimado','familia','pais_trabalhou',
        'pais_2020','pais_nascimento','etnia','Nascimento','Morte','Floresceu','genero','nobel'
      ];
      for (const key of ordem) {
        if (key === 'QI_calculado' || key === 'pIQ_HM_estimado') {
          if (validNum(round.target[key])) {
            const lab = labelFor(key, round.target[key]);
            if (!already.has(lab)) return lab;
          }
        } else {
          const val = round.target[key];
          const isNum = ['Nascimento','Morte','Floresceu'].includes(key);
          const ok = isNum ? validNum(val) : validText(val);
          if (ok) {
            const lab = labelFor(key, val);
            if (!already.has(lab)) return lab;
          }
        }
      }
      return null;
    };

    let nextText = null;

    if (used === 0) {
      nextText = round.secrets[0] || buildFallback();
    } else if (used === 1) {
      nextText = round.secrets[1] || buildFallback();
    } else if (used === 2) {
      const cur = round?.target?.curiosidades;
      const curLabel = validText(cur) ? labelFor('curiosidades', cur) : null;
      if (curLabel && !already.has(curLabel)) nextText = curLabel;
    } else {
      return;
    }

    if (!nextText) return; // nada concreto

    setRevealedSecrets(prev => [...prev, nextText]);
    setSecretUses(x => Math.min(3, x + 1));
  };

  const onSelect = (personObj) => {
    if (selection) return;
    const elapsed = Date.now() - startRef.current;
    stopTimer();

    const isCorrect = personObj.nome === round.target.nome;
    correctnessRef.current.push(isCorrect);
    timesMsRef.current.push(elapsed);

    const inc =
      secretUses >= 3 ? 0.5 :
      secretUses === 2 ? 0.7 :
      secretUses === 1 ? 0.8 : 1.0;

    if (isCorrect) {
      setCorrectCount(c => c + 1);
      setScorePoints(s => s + inc);
      playSound(SOUND_VICTORY);

      (async () => {
        try {
          if (bestCorrectMs == null || elapsed < bestCorrectMs) {
            setBestCorrectMs(elapsed);
            await AsyncStorage.setItem('adivinhe:bestCorrectMs', String(elapsed));
          }
        } catch {}
      })();
      setSelection({ person: personObj.person, status: 'correct' });
    } else {
      playSound(SOUND_DEFEAT);
      setSelection({ nome: personObj.nome, status: 'incorrect' });
    }

    // Não atualiza recorde por questão; salvamos ao final da sessão em finishSession().
  };

  // Próxima
  const next = () => {
    const answered = index + 1;
    if (answered % 5 === 0 && answered < config.rounds) {
      setShowMentor(true);
      return;
    }
    if (answered >= config.rounds) {
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
    stopTimer();
    const totalMs = Date.now() - sessionStartRef.current;
    const percentVal = config.rounds ? (scorePoints / config.rounds) : 0;
    setShowResult(true);

    try {
      const percentInt = Math.round(percentVal * 100);
      const finalScore = Math.round(scorePoints * 100) / 100;
      updateRecord('adivinhe', { score: finalScore, percent: percentInt, time_ms: totalMs });

      // ADICIONE: envia ao Supabase (results)
      await saveAdivinheResult({ score: finalScore, percent: percentInt, time_ms: totalMs });
    } catch (e) {
      console.log('[adivinhe] updateRecord/save error', e);
    }

    try {
      const prev = bestRun && bestRun.percent != null ? bestRun : { percent: 0, timeSec: Infinity, rounds: 0 };
      const current = { percent: percentVal, timeSec: Math.round(totalMs / 1000), rounds: config.rounds };
      const better = (percentVal > (prev.percent ?? 0)) ||
                     (percentVal === (prev.percent ?? 0) && current.timeSec < (prev.timeSec ?? Infinity));
      if (better) {
        setBestRun(current);
        await AsyncStorage.setItem('adiv:bestRun', JSON.stringify(current));
      }
    } catch {}
  };

  const mentorInfo = useMemo(() => {
    const last5 = correctnessRef.current.slice(-5);
    const last5Times = timesMsRef.current.slice(-5);
    const acc = last5.length ? Math.round((last5.filter(Boolean).length / last5.length) * 100) : 0;
    const avg = last5Times.length ? Math.round(last5Times.reduce((a, b) => a + b, 0) / last5Times.length) : null;

    let msg = 'Continue! Padrões emergem com prática.';
    if (acc >= 80) msg = 'Excelente precisão! Mantenha a calma para ganhar velocidade.';
    else if (acc >= 60) msg = 'Bom ritmo. Use as pistas extras para decidir melhor.';
    else msg = 'Sem pressa: foque nas pistas fortes e descarte alternativas.';

    return { acc, avg, msg };
  }, [showMentor]);

  // GATING hooks (mover para antes de iniciarAdivinhe)
  const { plano } = usePlano();              // plano atual (free/premium)
  const { open: openPaywall } = usePaywall(); // modal paywall

  if (showIntro) {
    return (
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
        {/* Header em overlay para não empurrar o centro */}
        <View style={[styles.header, styles.headerOverlay, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtnLg}>
            <Feather name="settings" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Centro realmente centralizado */}
        <View style={styles.introCenter}>
          <View style={styles.introCard}>
            <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.introSettingsBtn}>
              <Feather name="settings" size={18} color="#fff" />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginBottom: 8 }}>
              <Feather name="help-circle" size={22} color="#ffd166" />
              <Text style={styles.introTitle}>Adivinhe quem é</Text>
            </View>
            <Text style={styles.introText}>
              Você verá 3 pistas sobre uma personalidade e 4 alternativas de nome.
              Há 3 Pistas Secretas: usar 1 reduz o acerto para 0,8 ponto; usar 2 reduz para 0,7; usar 3 reduz para 0,5.
              {'\n\n'}
            </Text>
            <Text style={styles.introTips}>Analise com calma!</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={iniciarAdivinhe} activeOpacity={0.9}>
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
          difficulty={config.difficulty}
          onDifficultyChange={saveDifficulty}
          bestCorrectMs={bestCorrectMs}
          bestRun={bestRun}
        />
      </LinearGradient>
    );
  }

  if (!round) {
    return <ActivityIndicator size="large" color="#fff" style={{ flex: 1, backgroundColor: '#0f2027' }} />;
  }

  const answered = index + 1;
  const percent = Math.round((scorePoints / config.rounds) * 100);
  const m = medalInfo(percent);

  // Mostrar/ocultar botão de pista: a 3ª só se houver curiosidades disponível
  const curVal = round?.target?.curiosidades;
  const curiosityLabel = validText(curVal) ? labelFor('curiosidades', curVal) : null;
  const curiosityAlreadyShown = curiosityLabel ? [...round.hints, ...revealedSecrets].includes(curiosityLabel) : true;
  const canUseThirdSecret = Boolean(curiosityLabel && !curiosityAlreadyShown);
  // Próxima pista secreta disponível?
  // used=0 -> precisa existir round.secrets[0]
  // used=1 -> precisa existir round.secrets[1]
  // used=2 -> precisa existir curiosidades válida e inédita (H6)
  const usedSecrets = revealedSecrets.length;

  const curiosidadeLabel =
    round && validText(round?.target?.curiosidades)
      ? labelFor('curiosidades', round.target.curiosidades)
      : null;

  const curiosidadeDisponivel =
    !!curiosidadeLabel &&
    !round?.hints?.includes(curiosidadeLabel) &&
    !revealedSecrets.includes(curiosidadeLabel);

  // Verifica se existe algum atributo fallback que ainda não foi mostrado (para H4/H5)
  const fallbackSecretDisponivel = (() => {
    if (!round) return false;
    const already = new Set([...round.hints, ...revealedSecrets]);
    const ordem = [
      'sub_area_atuacao','QI_calculado','pIQ_HM_estimado','familia','pais_trabalhou',
      'pais_2020','pais_nascimento','etnia','Nascimento','Morte','Floresceu','genero','nobel'
    ];
    for (const key of ordem) {
      if (key === 'QI_calculado' || key === 'pIQ_HM_estimado') {
        if (validNum(round.target[key])) {
          const lab = labelFor(key, round.target[key]);
          if (!already.has(lab)) return true;
        }
      } else {
        const val = round.target[key];
        const isNum = ['Nascimento','Morte','Floresceu'].includes(key);
        const ok = isNum ? validNum(val) : validText(val);
        if (ok) {
          const lab = labelFor(key, val);
          if (!already.has(lab)) return true;
        }
      }
    }
    return false;
  })();

  const nextSecretAvailable = (() => {
    if (!round) return false;
    if (usedSecrets === 0) return !!round.secrets[0] || fallbackSecretDisponivel; // H4
    if (usedSecrets === 1) return !!round.secrets[1] || fallbackSecretDisponivel; // H5
    if (usedSecrets === 2) return curiosidadeDisponivel;                           // H6
    return false;
  })();

  const showSecretBtn = nextSecretAvailable; // só mostra se realmente há algo a revelar

  // Texto do botão com pontuação resultante após usá-la
  const secretBtnText =
    usedSecrets === 0
      ? 'Pista 1 - Vale 0,8'
      : usedSecrets === 1
        ? 'Pista 2 - Vale 0,7'
        : 'Pista 3 - Vale 0,5';

  // (Opcional) se você adicionou no revealSecret: if (!nextSecretAvailable) return;
  // garanta que revealSecret está definido DEPOIS ou remova esse guard se der erro.

  // SafeScreen sem topo/bottom (laterais). Topo vem de insets.top no header.
  return (
    <SafeScreen edges={['left','right']} style={styles.root}>
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        {/* Header com topo dinâmico */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Feather name="target" size={18} color="#00d3aa" />
            <Text style={styles.title}>Adivinhe quem é</Text>
          </View>

          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
            <Feather name="settings" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.chipsRow}>
          <View style={styles.chip}><Feather name="list" size={14} color="#00d3aa" /><Text style={styles.chipTxt}>{answered}/{config.rounds}</Text></View>
          <View style={styles.chip}><Feather name="award" size={14} color="#ffd166" /><Text style={styles.chipTxt}>Pontos: {scorePoints.toFixed(2)}</Text></View>
          <View style={styles.chip}><Feather name="clock" size={14} color="#9ad8ff" /><Text style={styles.chipTxt}>Tempo: {(tickMs/1000).toFixed(2)}s</Text></View>
        </View>

       
        <SafeScreen.Scroll
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, gap: 12 }}
          extraBottom={Platform.OS === 'ios' ? 56 : 96}
        >
          <View style={styles.hintsCard}>
            {round.hints.map((h, i) => (
              <View key={`hint-${i}`} style={styles.hintRow}>
                <Feather name="chevrons-right" size={16} color="#00d3aa" />
                <Text style={styles.hintText}>{h}</Text>
              </View>
            ))}

            {revealedSecrets.map((h, i) => (
              <View key={`secret-${i}`} style={styles.hintRow}>
                <Feather name="eye" size={16} color="#ffd166" />
                <Text style={styles.hintText}>{h}</Text>
              </View>
            ))}

            {showSecretBtn && (
              <TouchableOpacity
                style={[
                  styles.secretBtn,
                  secretUses === 1 && styles.secretBtnOnce,
                  (secretUses >= 3 || (secretUses === 2 && !canUseThirdSecret)) && styles.secretBtnDisabled
                ]}
                onPress={revealSecret}
                activeOpacity={0.9}
                disabled={secretUses >= 3 || (secretUses === 2 && !canUseThirdSecret)}
              >
                <Feather
                  name="eye"
                  size={16}
                  color={(secretUses >= 3 || (secretUses === 2 && !canUseThirdSecret)) ? '#8895a7' : (secretUses === 1 ? '#0a0f12' : '#00d3aa')}
                />
                <Text
                  style={[
                    styles.secretTxt,
                    secretUses === 1 && { color: '#0a0f12' },
                    (secretUses >= 3 || (secretUses === 2 && !canUseThirdSecret)) && { color: '#8895a7' }
                  ]}
                >
                  {secretBtnText}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Opções */}
          <View style={{ gap: 12, marginBottom: 10 }}>
            {round.options.map((opt) => {
              const nome = nomeOf(opt);
              const isSelected = selection?.nome === nome;

              let styleBtn = styles.optionButton;

              // Apenas estiliza o botão que foi selecionado
              if (isSelected) {
                if (selection.status === 'correct') {
                  styleBtn = styles.correctButton; // Fica verde se a seleção foi correta
                } else {
                  styleBtn = styles.incorrectButton; // Fica vermelho se a seleção foi incorreta
                }
              }

              return (
                <TouchableOpacity
                  key={personKey(opt)}
                  style={styleBtn}
                  onPress={() => onSelect(opt)}
                  disabled={!!selection}
                  activeOpacity={0.9}
                >
                  <Text style={styles.optionText}>{nome}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Botão Próxima dentro do Scroll (não corta) */}
          {selection && (
            <TouchableOpacity style={styles.nextButtonCentered} onPress={next} activeOpacity={0.9}>
              <Text style={styles.nextButtonText}>{answered >= config.rounds ? 'Finalizar' : 'Próxima'}</Text>
              <Feather name="play-circle" size={18} color="#0a0f12" />
            </TouchableOpacity>
          )}
        </SafeScreen.Scroll>

        {/* Rodapé fixo (sem safe area bottom no container) */}
        <View style={styles.footerCompact}>
          <Text style={styles.percentTxt}>Aproveitamento: {percent}%</Text>
        </View>

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

        <Modal visible={showResult} transparent={false} animationType="slide" onRequestClose={() => setShowResult(false)}>
          <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
            <View style={styles.resultWrap}>
              {scorePoints / config.rounds >= PASS_THRESHOLD && (
                <Confetti count={180} duration={4500} />
              )}

              <Feather name={m.icon} size={82} color={m.color} style={styles.medalIcon} />
              <Text style={styles.resTitulo}>{m.label}</Text>

              <View style={styles.resultsGrid}>
                <View style={styles.resItem}>
                  <Feather name="award" size={18} color="#ffd166" />
                  <Text className="val" style={styles.resVal}>{scorePoints.toFixed(2)} / {config.rounds}</Text>
                  <Text className="key" style={styles.resKey}>Pontos</Text>
                </View>
                <View style={styles.resItem}>
                  <Feather name="percent" size={18} color="#9ad8ff" />
                  <Text style={styles.resVal}>{percent}%</Text>
                  <Text style={styles.resKey}>Aproveitamento</Text>
                </View>
                <View style={styles.resItem}>
                  <Feather name="zap" size={18} color="#00d3aa" />
                  <Text style={styles.resVal}>{msToStr(bestCorrectMs)}</Text>
                  <Text style={styles.resKey}>Resposta mais rápida</Text>
                </View>
              </View>

              <Text style={styles.motMsg}>
                {percent >= 70
                  ? 'Excelente! Continue combinando Área + País para decidir mais rápido.'
                  : 'Bom caminho! Foque nas pistas fortes (Área/QI) e refine por País/Época.'}
              </Text>

              <View style={styles.factBox}>
                <Text style={styles.factTitle}>Curiosidade</Text>
                <Text style={styles.factText}>{randOf(EDU_FACTS)}</Text>
              </View>

              <View style={styles.resultsBtnGroup}>
                <TouchableOpacity style={styles.resultPrimaryBtn} onPress={iniciarAdivinhe} activeOpacity={0.9}>
                  <Feather name="rotate-ccw" size={18} color="#0a0f12" />
                  <Text style={styles.resultPrimaryTxt}>Reiniciar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resultSecondaryBtn}
                  onPress={() => { setShowResult(false); navigation.goBack(); }}
                  activeOpacity={0.9}
                >
                  <Feather name="home" size={18} color="#cfe7ff" />
                  <Text style={styles.resultSecondaryTxt}>Menu</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </Modal>

        <SettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          rounds={config.rounds}
          onRoundsChange={saveRounds}
          difficulty={config.difficulty}
          onDifficultyChange={saveDifficulty}
          bestCorrectMs={bestCorrectMs}
          bestRun={bestRun}
        />
      </LinearGradient>
    </SafeScreen>
  );
} // fim Adivinhe

function SettingsModal({ visible, onClose, rounds, onRoundsChange, difficulty = 'dificil', onDifficultyChange, bestCorrectMs, bestRun }) {
  const dec = () => onRoundsChange((rounds ?? DEFAULT_ROUNDS) - 1);
  const inc = () => onRoundsChange((rounds ?? DEFAULT_ROUNDS) + 1);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Configurações</Text>

          <Text style={styles.section}>Dificuldade</Text>
          <View style={styles.segmentRow}>
            <TouchableOpacity
              onPress={() => onDifficultyChange('facil')}
              style={[styles.segBtn, difficulty === 'facil' && styles.segBtnActive]}
            >
              <Text style={[styles.segBtnTxt, difficulty === 'facil' && styles.segBtnTxtActive]}>Fácil</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDifficultyChange('dificil')}
              style={[styles.segBtn, difficulty === 'dificil' && styles.segBtnActive]}
            >
              <Text style={[styles.segBtnTxt, difficulty === 'dificil' && styles.segBtnTxtActive]}>Difícil</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.settingsHelp}>
            Fácil: sorteia apenas personalidades com index acima de 20. Difícil: sem filtro.
          </Text>

          <Text style={styles.section}>Rodadas por partida</Text>
          <Text style={styles.settingsHelp}>Use −/+ ou arraste o controle para definir quantas rodadas jogar.</Text>
          <View style={styles.roundsRow}>
            <TouchableOpacity style={styles.stepBtn} onPress={dec}><Feather name="minus" size={18} color="#fff" /></TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={5} maximumValue={50} step={1}
                value={rounds ?? DEFAULT_ROUNDS}
                onValueChange={onRoundsChange}
                minimumTrackTintColor="#00d3aa" maximumTrackTintColor="rgba(255,255,255,0.2)" thumbTintColor="#00d3aa"
              />
              <Text style={styles.sliderValue}>Rodadas: {rounds ?? DEFAULT_ROUNDS}</Text>
            </View>
            <TouchableOpacity style={styles.stepBtn} onPress={inc}><Feather name="plus" size={18} color="#fff" /></TouchableOpacity>
          </View>

          <Text style={styles.section}>Seus recordes</Text>
          <View style={styles.resultsGrid}>
            <View style={styles.resItem}><Feather name="zap" size={18} color="#00d3aa" /><Text style={styles.resVal}>{msToStr(bestCorrectMs)}</Text><Text style={styles.resKey}>Resposta correta mais rápida</Text></View>
            <View style={styles.resItem}><Feather name="clock" size={18} color="#ffd166" /><Text style={styles.resVal}>{bestRun?.timeSec != null ? `${bestRun.timeSec}s` : '—'}</Text><Text style={styles.resKey}>Partida mais rápida</Text></View>
            <View style={styles.resItem}><Feather name="percent" size={18} color="#9ad8ff" /><Text style={styles.resVal}>{bestRun?.percent != null ? `${Math.round(bestRun.percent*100)}%` : '—'}</Text><Text style={styles.resKey}>Melhor % de acertos</Text></View>
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnTxt}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },

  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ALTERADO: paddingTop base 0; topo vem de insets <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
  header: { paddingTop: 0, paddingBottom: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerOverlay: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10 }, // <- novo
  backButton: { padding: 6 },

  iconBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14 },
  iconBtnLg: { padding: 14, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 20 },

  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },

  chipsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipTxt: { color: '#d1e8ff', fontSize: 12, fontWeight: '600' },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  hintsCard: {
    backgroundColor: 'rgba(8,12,20,0.45)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  hintRow: { flexDirection: 'row', alignItems: 'center' },
  hintText: { color: '#ffffffd9', fontSize: 16, marginLeft: 10, flex: 1 },

  secretBtn: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  secretBtnOnce: { backgroundColor: '#ffd166', borderColor: '#ffd166' },
  secretBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.08)' },
  secretTxt: { color: '#00d3aa', fontWeight: '700' },

  optionButton: { backgroundColor: '#232526', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#ffffff30' },
  correctButton: { backgroundColor: '#00d3aa', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#fff' },
  incorrectButton: { backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#fff' },
  optionText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },

  footerCompact: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6, alignItems: 'center' },
  percentTxt: { color: '#b2c7d3', fontSize: 13 },

  nextButtonCentered: { alignSelf: 'center', backgroundColor: '#ffd166', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  nextButtonText: { color: '#0a0f12', fontSize: 16, fontWeight: '800' },

  introCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  introCard: { width: '92%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 22, gap: 12 },
  introTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', marginLeft: 8 },
  introText: { color: '#d1e8ff', fontSize: 18, lineHeight: 24, marginTop: 8, textAlign: 'center' },
  introTips: { color: '#b2c7d3', fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 6 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', backgroundColor: '#101828', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalTitle: { color: '#fff', fontWeight: '900', fontSize: 20, marginBottom: 8, alignSelf: 'center' },
  modalMsg: { color: '#d1e8ff', fontSize: 14, textAlign: 'center', marginBottom: 10 },
  resultsGrid: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 6, flexWrap: 'wrap', gap: 10 },
  resItem: { alignItems: 'center', width: '30%' },
  resKey: { color: '#b2c7d3', fontSize: 11, marginTop: 2, textAlign: 'center' },
  resVal: { color: '#fff', fontWeight: '900', fontSize: 16, marginTop: 4, textAlign: 'center' },
  confettiLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },

  primaryBtn: { backgroundColor: '#00d3aa', paddingVertical: 12, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtnTxt: { color: '#0a0f12', fontWeight: '800' },
  secondaryBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryBtnTxt: { color: '#fff', fontWeight: '700' },

  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 10 },

  roundsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  stepBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12 },
  sliderValue: { color: '#d1e8ff', fontSize: 12, textAlign: 'center', marginTop: 2 },
  settingsHelp: { color: '#b2c7d3', fontSize: 12, marginBottom: 6 },
  medalIcon: { marginTop: 8 },
  resTitulo: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 6, marginBottom: 4, textAlign: 'center' },

  introSettingsBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },

  motMsg: { color: '#d1e8ff', fontSize: 14, textAlign: 'center', marginTop: 10, marginBottom: 10, lineHeight: 18 },

  resultsBtnGroup: { width: '100%', alignItems: 'center', gap: 12, marginTop: 12 },
  resultPrimaryBtn: {
    minWidth: '72%',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 28,
    backgroundColor: '#00d3aa',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  resultPrimaryTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 16 },
  resultSecondaryBtn: {
    minWidth: '72%',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resultSecondaryTxt: { color: '#e6f1ff', fontWeight: '800', fontSize: 16 },

  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
  },
  segBtnActive: { backgroundColor: '#00d3aa', borderColor: '#00d3aa' },
  segBtnTxt: { color: '#e6f1ff', fontWeight: '800' },
  segBtnTxtActive: { color: '#0a0f12' },
});