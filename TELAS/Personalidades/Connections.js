import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Confetti } from '../../components/Confetti';

import { supabase } from '../../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../../planoContext';
import { tentarUsar } from '../../core/gatingLocal';
import { usePaywall } from '../../paywallContext';

import { personalities } from './dataProcessor';
import { updateRecord } from './records';

const SOUND_START = require('../../assets/start.mp3');
const SOUND_VICTORY = require('../../assets/vitoria.mp3');
const SOUND_DEFEAT = require('../../assets/derrota.mp3');

const PASS_THRESHOLD = 0.7;
const DEFAULT_ROUNDS = 10;

const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const msToStr = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);

// ===== Helpers para “Em Comum” =====
const nomeOf = (p) => {
  const n = String(p?.nome ?? '').trim();
  return n || String(p?.person ?? '').trim();
};
const clean = (s) => String(s ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
const isKnown = (v) => {
  const s = clean(v).toLowerCase();
  return !!s && s !== 'desconhecido' && s !== 'nf' && s !== 'na' && s !== 'n/a';
};

const toCentury = (year) => {
  const y = Number(year);
  if (!Number.isFinite(y) || y <= 0) return null;
  const c = Math.floor((y - 1) / 100) + 1;
  const ROM = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'];
  return ROM[c - 1] ? `Século ${ROM[c - 1]}` : `Século ${c}`;
};
const toEra = (year) => {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  if (y < 500) return 'Antiguidade';
  if (y < 1500) return 'Idade Média';
  if (y < 1901) return 'Idade Moderna';
  return 'Contemporânea';
};
const toQiBand = (qi) => {
  const n = Number(qi);
  if (!Number.isFinite(n)) return null;
  if (n < 90) return '< 90';
  if (n < 100) return '90–99';
  if (n < 110) return '100–109';
  if (n < 120) return '110–119';
  if (n < 130) return '120–129';
  if (n < 140) return '130–139';
  if (n < 150) return '140–149';
  if (n < 160) return '150–159';
  if (n < 180) return '160–179';
  if (n < 200) return '180–199';
  return '200+';
};

// Extrai features relevantes do registro (opcionais, conforme dataProcessor)
function features(p) {
  // listas principais
  const inst = Array.isArray(p?.institutions_list) ? p.institutions_list.map(clean).filter(isKnown) : [];
  const campos = uniq([...(p?.campos_list || []), p?.area_atuacao].map(clean).filter(isKnown));
  const premios = Array.isArray(p?.premios_array) ? p.premios_array.map(x => clean(x?.award)).filter(isKnown) : [];

  // listas opcionais comuns
  const education = Array.isArray(p?.education_list) ? p.education_list.map(clean).filter(isKnown) : [];
  const conhecidoPor = Array.isArray(p?.conhecido_por_list) ? p.conhecido_por_list.map(clean).filter(isKnown) : [];

  // escalares de nascimento
  const paisNasc = isKnown(p?.pais_nascimento) ? clean(p.pais_nascimento) : null;
  const anoNasc = Number(p?.Nascimento ?? p?.nascimento) || null;
  const secNasc = toCentury(anoNasc);
  const eraNasc = toEra(anoNasc);

  // atuação/tempo
  const areaAtuacao = isKnown(p?.area_atuacao) ? clean(p.area_atuacao) : null;
  const subAreaAtuacao = isKnown(p?.sub_area_atuacao) ? clean(p.sub_area_atuacao) : null;
  const floresceu = Number(p?.Floresceu) || null;
  const secFloresceu = toCentury(floresceu);
  const eraFloresceu = toEra(floresceu);

  // localização 2020 / trabalho
  const pais2020 = isKnown(p?.pais_2020) ? clean(p.pais_2020) : null;
  const regiao2020 = isKnown(p?.regiao_2020) ? clean(p.regiao_2020) : null;
  const cidade2020 = isKnown(p?.cidade_2020) ? clean(p.cidade_2020) : null;
  const paisTrabalhou = isKnown(p?.pais_trabalhou) ? clean(p.pais_trabalhou) : null;

  // atributos pessoais
  const genero = isKnown(p?.genero) ? clean(p.genero) : null;
  const etnia = isKnown(p?.etnia) ? clean(p.etnia) : null;
  const familia = isKnown(p?.familia) ? clean(p.familia) : null;
  const imigrante = p?.imigrante === true || String(p?.imigrante).toLowerCase() === 'true';

  // QI
  const qiNum = Number(p?.QI_calculado ?? p?.pIQ_HM_estimado);
  const qiBand = toQiBand(qiNum);

  // Nobel
  const nobels = Array.isArray(p?.nobels) ? p.nobels : [];
  const temNobel = (nobels?.length ?? 0) > 0 || (isKnown(p?.nobel) && clean(p.nobel).toLowerCase() !== 'não');

  return {
    inst: uniq(inst),
    campos,
    premios: uniq(premios),

    education: uniq(education),
    conhecidoPor: uniq(conhecidoPor),

    paisNasc,
    secNasc,
    eraNasc,

    areaAtuacao,
    subAreaAtuacao,
    secFloresceu,
    eraFloresceu,

    pais2020,
    regiao2020,
    cidade2020,
    paisTrabalhou,

    genero,
    etnia,
    familia,
    imigrante,

    qiBand,
    temNobel,
  };
}

const label = (kind, val) => `${kind}: ${val}`;

function commonsBetween(a, b) {
  const fa = features(a);
  const fb = features(b);
  const inter = (arrA, arrB) => {
    const B = new Set((arrB || []).map(clean));
    return uniq((arrA || []).filter(x => B.has(clean(x))));
  };

  const out = [];
  // listas
  for (const v of inter(fa.inst, fb.inst)) out.push(label('Instituição em comum', v));
  for (const v of inter(fa.campos, fb.campos)) out.push(label('Campo/Área em comum', v));
  for (const v of inter(fa.premios, fb.premios)) out.push(label('Prêmio em comum', v));
  for (const v of inter(fa.education, fb.education)) out.push(label('Educação (instituição)', v));
  for (const v of inter(fa.conhecidoPor, fb.conhecidoPor)) out.push(label('Conhecido por', v));

  // escalares
  if (fa.paisNasc && fa.paisNasc === fb.paisNasc) out.push(label('País de nascimento', fa.paisNasc));
  if (fa.secNasc && fa.secNasc === fb.secNasc) out.push(label('Século de nascimento', fa.secNasc));
  if (fa.eraNasc && fa.eraNasc === fb.eraNasc) out.push(label('Época (era) de nascimento', fa.eraNasc));

  if (fa.pais2020 && fa.pais2020 === fb.pais2020) out.push(label('País (2020)', fa.pais2020));
  if (fa.regiao2020 && fa.regiao2020 === fb.regiao2020) out.push(label('Região (2020)', fa.regiao2020));
  if (fa.cidade2020 && fa.cidade2020 === fb.cidade2020) out.push(label('Cidade (2020)', fa.cidade2020));
  if (fa.paisTrabalhou && fa.paisTrabalhou === fb.paisTrabalhou) out.push(label('País onde trabalhou', fa.paisTrabalhou));

  if (fa.areaAtuacao && fa.areaAtuacao === fb.areaAtuacao) out.push(label('Área de atuação', fa.areaAtuacao));
  if (fa.subAreaAtuacao && fa.subAreaAtuacao === fb.subAreaAtuacao) out.push(label('Subárea de atuação', fa.subAreaAtuacao));

  if (fa.etnia && fa.etnia === fb.etnia) out.push(label('Etnia', fa.etnia));
  if (fa.familia && fa.familia === fb.familia) out.push(label('Origem familiar', fa.familia));

  if (fa.secFloresceu && fa.secFloresceu === fb.secFloresceu) out.push(label('Período ativo (século)', fa.secFloresceu));
  if (fa.eraFloresceu && fa.eraFloresceu === fb.eraFloresceu) out.push(label('Período ativo (era)', fa.eraFloresceu));

  if (fa.qiBand && fa.qiBand === fb.qiBand) out.push(label('Faixa de QI', fa.qiBand));

  // Nobel: apenas "Sim"
  if (fa.temNobel && fb.temNobel) out.push(label('Prêmio Nobel', 'Sim'));

  return uniq(out);
}

function makeDistractors(a, b, all, need, forbid = []) {
  const fa = features(a);
  const fb = features(b);
  const bad = new Set(forbid.map(clean));
  const addIf = (cond, txt) => (cond && !bad.has(clean(txt)) ? [txt] : []);

  const fromOne = uniq([
    // listas (presentes só em um)
    ...fa.inst.filter(x => !fb.inst.includes(x)).map(v => label('Instituição em comum', v)),
    ...fa.campos.filter(x => !fb.campos.includes(x)).map(v => label('Campo/Área em comum', v)),
    ...fa.premios.filter(x => !fb.premios.includes(x)).map(v => label('Prêmio em comum', v)),
    ...fa.education.filter(x => !fb.education.includes(x)).map(v => label('Educação (instituição)', v)),
    ...fa.conhecidoPor.filter(x => !fb.conhecidoPor.includes(x)).map(v => label('Conhecido por', v)),

    ...fb.inst.filter(x => !fa.inst.includes(x)).map(v => label('Instituição em comum', v)),
    ...fb.campos.filter(x => !fa.campos.includes(x)).map(v => label('Campo/Área em comum', v)),
    ...fb.premios.filter(x => !fa.premios.includes(x)).map(v => label('Prêmio em comum', v)),
    ...fb.education.filter(x => !fa.education.includes(x)).map(v => label('Educação (instituição)', v)),
    ...fb.conhecidoPor.filter(x => !fa.conhecidoPor.includes(x)).map(v => label('Conhecido por', v)),

    // escalares (diferentes usados como distratores)
    ...addIf(fa.paisNasc && fa.paisNasc !== fb.paisNasc, label('País de nascimento', fa.paisNasc)),
    ...addIf(fb.paisNasc && fb.paisNasc !== fa.paisNasc, label('País de nascimento', fb.paisNasc)),

    ...addIf(fa.secNasc && fa.secNasc !== fb.secNasc, label('Século de nascimento', fa.secNasc)),
    ...addIf(fb.secNasc && fb.secNasc !== fa.secNasc, label('Século de nascimento', fb.secNasc)),

    ...addIf(fa.eraNasc && fa.eraNasc !== fb.eraNasc, label('Época (era) de nascimento', fa.eraNasc)),
    ...addIf(fb.eraNasc && fb.eraNasc !== fa.eraNasc, label('Época (era) de nascimento', fb.eraNasc)),

    ...addIf(fa.pais2020 && fa.pais2020 !== fb.pais2020, label('País (2020)', fa.pais2020)),
    ...addIf(fb.pais2020 && fb.pais2020 !== fa.pais2020, label('País (2020)', fb.pais2020)),

    ...addIf(fa.regiao2020 && fa.regiao2020 !== fb.regiao2020, label('Região (2020)', fa.regiao2020)),
    ...addIf(fb.regiao2020 && fb.regiao2020 !== fa.regiao2020, label('Região (2020)', fb.regiao2020)),

    ...addIf(fa.cidade2020 && fa.cidade2020 !== fb.cidade2020, label('Cidade (2020)', fa.cidade2020)),
    ...addIf(fb.cidade2020 && fb.cidade2020 !== fa.cidade2020, label('Cidade (2020)', fb.cidade2020)),

    ...addIf(fa.paisTrabalhou && fa.paisTrabalhou !== fb.paisTrabalhou, label('País onde trabalhou', fa.paisTrabalhou)),
    ...addIf(fb.paisTrabalhou && fb.paisTrabalhou !== fa.paisTrabalhou, label('País onde trabalhou', fb.paisTrabalhou)),

    ...addIf(fa.areaAtuacao && fa.areaAtuacao !== fb.areaAtuacao, label('Área de atuação', fa.areaAtuacao)),
    ...addIf(fb.areaAtuacao && fb.areaAtuacao !== fa.areaAtuacao, label('Área de atuação', fb.areaAtuacao)),

    ...addIf(fa.subAreaAtuacao && fa.subAreaAtuacao !== fb.subAreaAtuacao, label('Subárea de atuação', fa.subAreaAtuacao)),
    ...addIf(fb.subAreaAtuacao && fb.subAreaAtuacao !== fa.subAreaAtuacao, label('Subárea de atuação', fb.subAreaAtuacao)),

    ...addIf(fa.genero && fa.genero !== fb.genero, label('Gênero', fa.genero)),
    ...addIf(fb.genero && fb.genero !== fa.genero, label('Gênero', fb.genero)),

    ...addIf(fa.etnia && fa.etnia !== fb.etnia, label('Etnia', fa.etnia)),
    ...addIf(fb.etnia && fb.etnia !== fa.etnia, label('Etnia', fb.etnia)),

    ...addIf(fa.familia && fa.familia !== fb.familia, label('Origem familiar', fa.familia)),
    ...addIf(fb.familia && fb.familia !== fa.familia, label('Origem familiar', fb.familia)),

    ...addIf(fa.secFloresceu && fa.secFloresceu !== fb.secFloresceu, label('Período ativo (século)', fa.secFloresceu)),
    ...addIf(fb.secFloresceu && fb.secFloresceu !== fa.secFloresceu, label('Período ativo (século)', fb.secFloresceu)),

    ...addIf(fa.eraFloresceu && fa.eraFloresceu !== fb.eraFloresceu, label('Período ativo (era)', fa.eraFloresceu)),
    ...addIf(fb.eraFloresceu && fb.eraFloresceu !== fa.eraFloresceu, label('Período ativo (era)', fb.eraFloresceu)),

    ...addIf(fa.qiBand && fa.qiBand !== fb.qiBand, label('Faixa de QI', fa.qiBand)),
    ...addIf(fb.qiBand && fb.qiBand !== fa.qiBand, label('Faixa de QI', fb.qiBand)),
  ]).filter(t => !bad.has(clean(t)));

  const out = [];
  while (out.length < need && fromOne.length) {
    const i = Math.floor(Math.random() * fromOne.length);
    const [pick] = fromOne.splice(i, 1);
    if (!out.includes(pick)) out.push(pick);
  }

  // ruído de outros registros, se faltar (sem "Nobel: Não")
  let safety = 300;
  while (out.length < need && safety-- > 0) {
    const r = all[Math.floor(Math.random() * all.length)];
    if (!r || r === a || r === b) continue;
    const fr = features(r);
    const candidates = uniq([
      ...fr.inst.map(v => label('Instituição em comum', v)),
      ...fr.campos.map(v => label('Campo/Área em comum', v)),
      ...fr.premios.map(v => label('Prêmio em comum', v)),
      ...fr.education.map(v => label('Educação (instituição)', v)),
      ...fr.conhecidoPor.map(v => label('Conhecido por', v)),

      ...(fr.paisNasc ? [label('País de nascimento', fr.paisNasc)] : []),
      ...(fr.secNasc ? [label('Século de nascimento', fr.secNasc)] : []),
      ...(fr.eraNasc ? [label('Época (era) de nascimento', fr.eraNasc)] : []),

      ...(fr.pais2020 ? [label('Nasceram onde atualmente é', fr.pais2020)] : []),
      ...(fr.cidade2020 ? [label('Nasceram onde atualmente é', fr.cidade2020)] : []),
      ...(fr.paisTrabalhou ? [label('País onde trabalharam é', fr.paisTrabalhou)] : []),

      ...(fr.areaAtuacao ? [label('Área de atuação', fr.areaAtuacao)] : []),
      ...(fr.subAreaAtuacao ? [label('Subárea de atuação', fr.subAreaAtuacao)] : []),

      ...(fr.genero ? [label('Gênero', fr.genero)] : []),
      ...(fr.etnia ? [label('Etnia', fr.etnia)] : []),
      ...(fr.familia ? [label('Origem familiar', fr.familia)] : []),

      ...(fr.secFloresceu ? [label('Período ativo (século)', fr.secFloresceu)] : []),
      ...(fr.eraFloresceu ? [label('Período ativo (era)', fr.eraFloresceu)] : []),

      ...(fr.qiBand ? [label('Faixa de QI', fr.qiBand)] : []),

      ...(fr.temNobel ? [label('Prêmio Nobel', 'Sim')] : []), // nunca adicionar "Não"
    ]).filter(t => !bad.has(clean(t)));
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!out.includes(pick)) out.push(pick);
  }

  return out.slice(0, need);
}

function makePairRound(all) {
  const pool = (all || personalities).filter(p => nomeOf(p));
  if (pool.length < 8) return null;

  let A = null, B = null, commons = [];
  let tries = 150;
  while (tries-- > 0) {
    A = pool[Math.floor(Math.random() * pool.length)];
    B = pool[Math.floor(Math.random() * pool.length)];
    if (!A || !B || A === B || nomeOf(A) === nomeOf(B)) continue;
    commons = commonsBetween(A, B);
    if (commons.length) break;
  }
  if (!commons.length) return null;

  const correct = commons[Math.floor(Math.random() * commons.length)];
  const distractors = makeDistractors(A, B, pool, 4, [correct]);
  const options = shuffle([correct, ...distractors]).slice(0, 5);

  return { pair: [A, B], options, correct };
}

// ===== Componente principal =====
export default function Connections({ navigation }) {
  // sessão
  const [config, setConfig] = useState({ rounds: DEFAULT_ROUNDS });
  const [showIntro, setShowIntro] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showMentor, setShowMentor] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const [round, setRound] = useState(null);
  const [index, setIndex] = useState(0);
  const [scorePoints, setScorePoints] = useState(0);
  const [selection, setSelection] = useState(null);
  const [tickMs, setTickMs] = useState(0);

  // >>> GATING estado/hooks
  const [startingGate, setStartingGate] = useState(false);
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();

  const startRef = useRef(Date.now());
  const tickRef = useRef(null);
  const timesMsRef = useRef([]);
  const correctnessRef = useRef([]);
  const sessionStartRef = useRef(0);

  const soundRef = useRef(null);

  const [bestCorrectMs, setBestCorrectMs] = useState(null);
  const [bestRun, setBestRun] = useState({ percent: null, timeSec: null, rounds: null });

  // Usuário autenticado (para salvar no Supabase)
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
        const c = await AsyncStorage.getItem('conn:config');
        if (c) setConfig(JSON.parse(c));
        const bc = await AsyncStorage.getItem('conn:bestCorrectMs');
        if (bc) setBestCorrectMs(Number(bc));
        const br = await AsyncStorage.getItem('conn:bestRun');
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
    setRound(makePairRound(personalities));
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

  // >>> GATING função (usa código CONNECTIONS)
  const iniciarConnections = useCallback(async () => {
    if (startingGate) return;
    setStartingGate(true);
    try {
      console.log('[CONNECTIONS] tentarUsar CONNECTIONS plano=', plano);
      const r = await tentarUsar('CONNECTIONS', plano);
      console.log('[CONNECTIONS] resultado tentarUsar', r);
      if (!r.ok) {
        if (r.erro === 'nao_logado') { navigation.navigate('Login'); return; }
        if (r.erro === 'limite') { openPaywall(); return; }
        if (r.erro === 'compra_unica_necessaria') { openPaywall('CONNECTIONS'); return; }
        if (r.erro === 'codigo_desconhecido') { startGame(); return; } // fallback
        return;
      }
      startGame();
    } finally {
      setStartingGate(false);
    }
  }, [startingGate, plano, navigation, openPaywall, startGame]);

  const saveRounds = async (val) => {
    const v = Math.max(5, Math.min(50, Math.round(val)));
    const next = { rounds: v };
    setConfig(next);
    try { await AsyncStorage.setItem('conn:config', JSON.stringify(next)); } catch {}
  };

  // Sempre antes de returns condicionais
  const mentorInfo = useMemo(() => {
    const last5 = correctnessRef.current.slice(-5);
    const last5Times = timesMsRef.current.slice(-5);
    const acc = last5.length ? Math.round((last5.filter(Boolean).length / last5.length) * 100) : 0;
    const avg = last5Times.length ? Math.round(last5Times.reduce((a, b) => a + b, 0) / last5Times.length) : null;
    let msg = 'Procure convergências óbvias (instituição, área, país).';
    if (acc >= 80) msg = 'Excelente! Continue usando as pistas fortes.';
    else if (acc >= 60) msg = 'Bom! Foque em país/era e depois refine por área.';
    else msg = 'Elimine distratores que servem só para um dos nomes.';
    return { acc, avg, msg };
  }, [showMentor]);

  if (showIntro) {
    return (
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
            <Feather name="settings" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.introCenter}>
          <View style={styles.introCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginBottom: 8 }}>
              <Feather name="link-2" size={22} color="#a78bfa" />
              <Text style={styles.introTitle}>Em Comum</Text>
            </View>
            <Text style={styles.introText}>
              Duas personalidades serão exibidas. Escolha, entre as alternativas, o que elas têm em comum
              (instituições, campos/áreas, prêmios, país, século/época, QI, Nobel Sim).
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={iniciarConnections}
              activeOpacity={0.9}
              disabled={startingGate}
            >
              <Feather name="play-circle" size={20} color="#0a0f12" />
              <Text style={styles.primaryBtnTxt}>{startingGate ? '...' : 'Começar'}</Text>
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

  if (!round) {
    return <ActivityIndicator size="large" color="#fff" style={{ flex: 1, backgroundColor: '#0f2027' }} />;
  }

  const answered = index + 1;
  const percent = Math.round((scorePoints / config.rounds) * 100);

  const onSelect = (opt) => {
    if (selection) return;
    const elapsed = Date.now() - startRef.current;
    stopTimer();

    const isCorrect = opt === round.correct;
    timesMsRef.current.push(elapsed);
    correctnessRef.current.push(isCorrect);

    if (isCorrect) {
      setScorePoints(s => s + 1);
      (async () => {
        try {
          if (bestCorrectMs == null || elapsed < bestCorrectMs) {
            setBestCorrectMs(elapsed);
            await AsyncStorage.setItem('conn:bestCorrectMs', String(elapsed));
          }
        } catch {}
      })();
      playSound(SOUND_VICTORY);
    } else {
      playSound(SOUND_DEFEAT);
    }

    setSelection(opt);
    updateRecord('connections', Math.floor(scorePoints + (isCorrect ? 1 : 0)));
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
    stopTimer();
    const totalMs = Date.now() - sessionStartRef.current;
    setShowResult(true);

    const percentVal = scorePoints / config.rounds;
    const percentInt = Math.round(percentVal * 100);

    try {
      const prev = bestRun && bestRun.percent != null ? bestRun : { percent: 0, timeSec: Infinity, rounds: 0 };
      const current = { percent: percentVal, timeSec: Math.round(totalMs / 1000), rounds: config.rounds };
      const better = (percentVal > (prev.percent ?? 0)) ||
                     (percentVal === (prev.percent ?? 0) && current.timeSec < (prev.timeSec ?? Infinity));
      if (better) {
        setBestRun(current);
        await AsyncStorage.setItem('conn:bestRun', JSON.stringify(current));
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
        // tenta com user_id (se o schema tiver a coluna)
        const payload = { ...basePayload, user_id: authUser.id };
        let { error } = await supabase.from('personalities_connections_results').insert(payload);
        if (error) {
          // tenta sem user_id
          const { user_id, ...rest } = payload;
          ({ error } = await supabase.from('personalities_connections_results').insert(rest));
          // se também falhar pelo user_name, tenta sem ele
          if (error && /user_name/i.test(error.message)) {
            const { user_name, ...rest2 } = rest;
            await supabase.from('personalities_connections_results').insert(rest2);
          }
        }
      } catch {}
    }
  };

  const [A, B] = round.pair;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Feather name="link-2" size={18} color="#a78bfa" />
            <Text style={styles.title}>Em Comum</Text>
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

        {/* Dois nomes */}
        <View style={styles.content}>
          <View style={styles.hintsCard}>
            <Text style={styles.question}>O que esses dois personagens têm em comum:</Text>
            <Text style={[styles.nameItem, { fontWeight: '800', textAlign: 'center', fontSize: 18 }]}>
              {nomeOf(A)} <Text style={{ opacity: 0.6 }}>&</Text> {nomeOf(B)}
            </Text>
          </View>

          {/* Opções */}
          <View style={{ gap: 12 }}>
            {round.options.map((opt) => {
              const isSelected = selection === opt;
              const isCorrect = round.correct === opt;

              let styleBtn = styles.optionButton;
              if (selection && isSelected && isCorrect) styleBtn = styles.correctButton;
              if (selection && isSelected && !isCorrect) styleBtn = styles.incorrectButton;

              return (
                <TouchableOpacity
                  key={opt}
                  style={styleBtn}
                  onPress={() => onSelect(opt)}
                  disabled={!!selection}
                  activeOpacity={0.9}
                >
                  <Text style={styles.optionText}>{opt}</Text>
                </TouchableOpacity>
              );
            })}

            {/* Botão Próxima centralizado logo abaixo das alternativas */}
            {selection ? (
              <View style={styles.nextInlineWrap}>
                <TouchableOpacity style={styles.nextButton} onPress={next} activeOpacity={0.9}>
                  <Text style={styles.nextButtonText}>{answered >= config.rounds ? 'Finalizar' : 'Próxima'}</Text>
                  <Feather name="play-circle" size={18} color="#0a0f12" />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.percentTxt}>Aproveitamento: {percent}%</Text>
          {/* botão movido para logo abaixo das alternativas */}
          <View style={{ height: 0 }} />
        </View>

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
              {scorePoints / config.rounds >= PASS_THRESHOLD && (
                <Confetti count={160} duration={4500} />
              )}
              <Text style={styles.modalTitle}>
                {scorePoints / config.rounds >= PASS_THRESHOLD ? 'Parabéns!' : 'Resultado'}
              </Text>
              <View style={styles.resultsGrid}>
                <View style={styles.resItem}><Feather name="award" size={18} color="#ffd166" /><Text style={styles.resVal}>{scorePoints} / {config.rounds}</Text><Text style={styles.resKey}>Pontos</Text></View>
                <View style={styles.resItem}><Feather name="percent" size={18} color="#9ad8ff" /><Text style={styles.resVal}>{percent}%</Text><Text style={styles.resKey}>Aproveitamento</Text></View>
                <View style={styles.resItem}><Feather name="zap" size={18} color="#00d3aa" /><Text style={styles.resVal}>{msToStr(bestCorrectMs)}</Text><Text style={styles.resKey}>Resposta mais rápida</Text></View>
              </View>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={iniciarConnections}
                activeOpacity={0.9}
                disabled={startingGate}
              >
                <Text style={styles.primaryBtnTxt}>{startingGate ? '...' : 'Reiniciar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setShowResult(false); navigation.goBack(); }}>
                <Text style={styles.secondaryBtnTxt}>Menu</Text>
              </TouchableOpacity>
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
    </View>
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

          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnTxt}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Estilos
const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },

  header: { paddingTop: 56, paddingBottom: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { padding: 6 },
  iconBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14 },

  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },

  chipsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipTxt: { color: '#d1e8ff', fontSize: 12, fontWeight: '600' },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  hintsCard: { backgroundColor: 'rgba(8,12,20,0.45)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', padding: 16, marginBottom: 12, gap: 8 },
  question: { color: '#9fe870', fontSize: 14, marginBottom: 4, textAlign: 'center' },
  nameItem: { color: '#ffffffd9', fontSize: 16 },

  optionButton: { backgroundColor: '#232526', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#ffffff30' },
  correctButton: { backgroundColor: '#00d3aa', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#fff' },
  incorrectButton: { backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#fff' },
  optionText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 24, paddingTop: 10 },
  percentTxt: { color: '#b2c7d3', fontSize: 13 },
  // botão agora é inline abaixo das alternativas
  nextInlineWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  nextButton: { backgroundColor: '#ffd166', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextButtonText: { color: '#0a0f12', fontSize: 16, fontWeight: '800' },

  // Intro / Modais
  introCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  introCard: { width: '92%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 18 },
  introTitle: { color: '#a78bfa', fontSize: 18, fontWeight: '800', marginLeft: 8 },
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