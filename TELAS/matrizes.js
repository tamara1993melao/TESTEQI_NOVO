import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Image, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
// import ConfettiCannon from 'react-native-confetti-cannon';
import { Confetti } from '../components/Confetti';
import { buildMatrizDeck } from './dados/matrizesIndex';
import { supabase } from '../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../planoContext';
import { tentarUsar } from '../core/gatingLocal';
import { usePaywall } from '../paywallContext';

const MESSAGE_MS = 6000;
const BLOCK_SIZE = 8;

// Busca o nome público do usuário (apelido > nome > metadata > e-mail)
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

// Salva/atualiza melhor registro por usuário no Supabase (tabela: matrices_results)
// Critério de "melhor": maior score (percent). Empate => menor time_ms (média em ms).
const saveMatricesRecord = async ({ displayName, score, correct, time_ms }) => {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;

    const payload = {
      user_id: uid,                          // chave real por usuário logado
      user_name: (displayName || 'Convidado').slice(0, 80), // para exibir
      score: score ?? null,                  // percent (0-100)
      correct: correct ?? null,              // acertos
      time_ms: time_ms ?? null,              // média ms (int)
    };

    // Tenta achar registro existente do usuário
    let existing = null;
    if (uid) {
      const { data, error, status } = await supabase
        .from('matrices_results')
        .select('id, score, time_ms')
        .eq('user_id', uid)
        .maybeSingle();
      if (error && status !== 406) {
        console.log('[Supabase][matrices_results] select uid error:', error);
        return false;
      }
      existing = data || null;
    } else {
      // Convidado: usa nome como fallback (sem garantia de unicidade)
      const { data, error, status } = await supabase
        .from('matrices_results')
        .select('id, score, time_ms')
        .eq('user_name', payload.user_name)
        .maybeSingle();
      if (error && status !== 406) {
        console.log('[Supabase][matrices_results] select uname error:', error);
        return false;
      }
      existing = data || null;
    }

    // Se não existe, insere
    if (!existing) {
      const { data, error } = await supabase
        .from('matrices_results')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        console.log('[Supabase][matrices_results] insert error:', error);
        return false;
      }
      console.log('[Supabase][matrices_results] insert ok id=', data?.id);
      return true;
    }

    // Compara para manter apenas o melhor
    const better =
      (payload.score ?? -1) > (existing.score ?? -1) ||
      ((payload.score ?? -1) === (existing.score ?? -1) &&
        (payload.time_ms ?? Number.MAX_SAFE_INTEGER) < (existing.time_ms ?? Number.MAX_SAFE_INTEGER));

    if (!better) {
      console.log('[Supabase][matrices_results] keep existing; new is not better');
      return true;
    }

    const { error: updErr } = await supabase
      .from('matrices_results')
      .update(payload)
      .eq('id', existing.id);

    if (updErr) {
      console.log('[Supabase][matrices_results] update error:', updErr);
      return false;
    }
    console.log('[Supabase][matrices_results] update ok id=', existing.id);
    return true;
  } catch (e) {
    console.log('[Supabase][matrices_results] exception:', e?.message || e);
    return false;
  }
};

function useEndSounds() {
  const ref = useRef({ victory: null, defeat: null });
  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true, allowsRecordingIOS: false, shouldDuckAndroid: true });
      } catch {}
      try {
        const victory = new Audio.Sound();
        const defeat = new Audio.Sound();
        await victory.loadAsync(require('../assets/vitoria.mp3'), { volume: 1.0 });
        await defeat.loadAsync(require('../assets/derrota.mp3'), { volume: 1.0 });
        ref.current = { victory, defeat };
      } catch (e) { console.log('sons matrizes', e); }
    })();
    return () => {
      Object.values(ref.current).forEach(s => s && s.unloadAsync());
    };
  }, []);
  const play = async (k) => { try { await ref.current[k]?.stopAsync(); await ref.current[k]?.setPositionAsync(0); await ref.current[k]?.playAsync(); } catch {} };
  return { playVictory: () => play('victory'), playDefeat: () => play('defeat') };
}

// >>> REMOTE MATRIZES (novo)
const REMOTE_BUCKET = 'matrizes';
const REMOTE_MANIFEST_PATH = 'manifest.json';           // manifest.json na raiz do bucket
const REMOTE_AUTO_FROM = 4;                             // fallback range
const REMOTE_AUTO_TO = 24;
const LETTER_TO_INDEX = { a:0,b:1,c:2,d:3,e:4,f:5 };
const PROMPT_CANDIDATES = ['Questao.webp','questao.webp']; // tenta ambos

function useRemoteMatrizes() {
  const [remoteData, setRemoteData] = useState({ loading: true, items: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = supabase.storage.from(REMOTE_BUCKET).getPublicUrl(REMOTE_MANIFEST_PATH);
        const manifestUrl = data?.publicUrl;
        let entries = null;
        if (manifestUrl) {
          const r = await fetch(manifestUrl);
          if (r.ok) {
            const json = await r.json().catch(()=>null);
            if (Array.isArray(json)) {
              entries = json;
              console.log('[MATRIZES][remote] manifest ok itens=', json.length);
            } else {
              console.log('[MATRIZES][remote] manifest inválido (não array)');
            }
          } else {
            console.log('[MATRIZES][remote] manifest status', r.status);
          }
        } else {
          console.log('[MATRIZES][remote] manifest sem URL pública');
        }

        if (!entries) {
          entries = [];
          for (let i = REMOTE_AUTO_FROM; i <= REMOTE_AUTO_TO; i++) {
            const num = String(i).padStart(4,'0');
            entries.push({ folder:`item${num}`, correct:'a' });
          }
          console.log('[MATRIZES][remote] usando lista auto', entries.length);
        }

        const items = [];
        for (const entry of entries) {
          if (!entry?.folder) continue;
          const base = entry.folder.replace(/^\/+|\/+$/g,'');
          const correctLetter = String(entry.correct || 'a').toLowerCase();
          const correctIndex = LETTER_TO_INDEX[correctLetter];
          if (correctIndex == null) {
            console.log(`[MATRIZES][remote] SKIPPING item ${base} - Letra inválida: ${correctLetter}`);
            continue;
          }
          
          let promptUrl = null;
          for (const cand of PROMPT_CANDIDATES) {
            const u = supabase.storage.from(REMOTE_BUCKET).getPublicUrl(`${base}/${cand}`).data.publicUrl;
            try {
              console.log(`[MATRIZES][remote] Validando: ${u}`);
              const head = await fetch(u, { method:'GET' });
              if (head.ok) {
                promptUrl = u;
                break;
              } else {
                console.log(`[MATRIZES][remote] -> FALHOU status ${head.status}`);
              }
            } catch (e) {
              console.log(`[MATRIZES][remote] -> FALHOU fetch: ${e.message}`);
            }
          }

          if (!promptUrl) {
            console.log(`[MATRIZES][remote] SKIPPING item ${base} - Imagem da questão não encontrada.`);
            continue;
          }
          
          const options = ['a','b','c','d','e','f'].map(l => ({
            uri: supabase.storage.from(REMOTE_BUCKET).getPublicUrl(`${base}/alternativa_${l}.webp`).data.publicUrl
          }));
          items.push({
            id: entry.id || base,
            prompt: { uri: promptUrl },
            options,
            correctIndex,
            remote: true // <<< ADICIONAR ESTA LINHA
          });
        }

        if (alive) {
          setRemoteData({ loading: false, items });
          console.log('[MATRIZES][remote] loaded válidos=', items.length);
        }
      } catch (e) {
        console.log('[MATRIZES][remote] erro loader', e?.message || e);
        if (alive) setRemoteData(prev => ({ ...prev, loading: false }));
      }
    })();
    return () => { alive = false; };
  }, []);

  return remoteData;
}

// >>> NOVO CRONÔMETRO (isolado, evita re-render da tela inteira)
const Cronometro = React.memo(function Cronometro({ active, paused, restartKey, onTick }) {
  const [ms, setMs] = useState(0);
  const intervalRef = useRef(null);
  const startRef = useRef(0);
  const accRef = useRef(0); // tempo acumulado antes do último start

  // Reinicia somente quando muda a questão
  useEffect(() => {
    accRef.current = 0;
    setMs(0);
    if (active && !paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = accRef.current + (Date.now() - startRef.current);
        setMs(elapsed);
        onTick && onTick(elapsed);
      }, 100);
    }
    // cleanup quando troca questão
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [restartKey]); // somente questão

  // Controla pausa / retomada (sem zerar)
  useEffect(() => {
    if (!active) {
      // parar totalmente (ex: terminou / saiu)
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (paused) {
      if (intervalRef.current) {
        accRef.current += Date.now() - startRef.current;
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    // ativo e não pausado -> (re)iniciar incremental sem reset
    if (!intervalRef.current) {
      startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = accRef.current + (Date.now() - startRef.current);
        setMs(elapsed);
        onTick && onTick(elapsed);
      }, 100);
    }
    return () => {
      if (!active && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, paused]);

  return (
    <View style={styles.crono}>
      <Text style={styles.cronoTxt}>{ms} ms</Text>
    </View>
  );
});

export default function Matrizes({ navigation }) {
  // UI e estado
  const [showIntro, setShowIntro] = useState(true);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // >>> GATING estado
  const [startingGate, setStartingGate] = useState(false);
  // >>> GATING hooks
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();
  const { loading: remoteLoading, items: remoteItems } = useRemoteMatrizes();

  // Pausa e quantidade de séries
  const [paused, setPaused] = useState(false);
  const [seriesCount, setSeriesCount] = useState(10);
  const lastElapsedRef = useRef(0);  // recebe ms corrente do cronômetro

  // Deck e progresso
  const deckRef = useRef([]); // só monta ao iniciar jogo
  const [idx, setIdx] = useState(0);

  // Opções embaralhadas por questão
  const [shuffled, setShuffled] = useState({ options: [], correct: -1 });

  // Métricas
  const [hits, setHits] = useState(0);
  const [times, setTimes] = useState([]); // ms por questão
  const [lastRt, setLastRt] = useState(null);

  // Intermissões
  const [midMsg, setMidMsg] = useState(null);

  // Resultados
  const [showResults, setShowResults] = useState(false);
  const { playVictory, playDefeat } = useEndSounds();
  const [records, setRecords] = useState({ bestSingleMs: null, bestAvgMs: null, bestSingleName: '', bestAvgName: '' });
  const [siteRecords, setSiteRecords] = useState({ bestSingleMs: 650, bestAvgMs: 1200, bestSingleName: 'Site', bestAvgName: 'Site' });

  // Carregar recordes/config
  useEffect(() => {
    (async () => {
      try {
        const r = await AsyncStorage.getItem('matrizes:records'); if (r) setRecords(prev => ({ ...prev, ...JSON.parse(r) }));
        const s = await AsyncStorage.getItem('matrizes:site'); if (s) setSiteRecords(prev => ({ ...prev, ...JSON.parse(s) }));
        const sc = await AsyncStorage.getItem('matrizes:series'); if (sc) setSeriesCount(parseInt(sc, 10) || 10);
      } catch {}
    })();
  }, []);

  // Preparar questão
  const item = deckRef.current[idx];
  useEffect(() => {
    if (!item || showIntro || showResults || paused) return;
    // Embaralha opções
    const map = item.options.map((src, i) => ({ src, i }));
    map.sort(() => Math.random() - 0.5);
    const options = map.map(m => m.src);
    const correct = map.findIndex(m => m.i === item.correctIndex);
    setShuffled({ options, correct });
    // Cronômetro reiniciará via restartKey = idx
    lastElapsedRef.current = 0;
  }, [idx, item, showIntro, showResults, paused]);

  // Alternar pausa
  const togglePause = () => {
    if (showIntro || showResults || !running) return;
    setPaused(p => !p);
  };

  const onPick = async (choice) => {
    if (paused) return;
    if (!item || shuffled.correct < 0) return;

    const rt = lastElapsedRef.current; // tempo da questão
    setLastRt(rt);
    setTimes(t => [...t, rt]);

    const correct = choice === shuffled.correct;
    if (correct) setHits(h => h + 1);
    await Haptics.impactAsync(correct ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);

    const nextIdx = idx + 1;
    const isBlockEnd = nextIdx > 0 && nextIdx % BLOCK_SIZE === 0 && nextIdx < deckRef.current.length;
    if (isBlockEnd) {
      const acc = Math.round(((hits + (correct ? 1 : 0)) / nextIdx) * 100);
      setMidMsg(acc >= 80 ? 'Bom ritmo, continue assim!' : 'Tente observar padrões com mais calma.');
      setTimeout(() => { setMidMsg(null); setIdx(nextIdx); }, MESSAGE_MS);
    } else {
      setIdx(nextIdx);
    }
    if (nextIdx >= deckRef.current.length) finish();
  };

  const computeStats = (arr) => {
    if (!arr?.length) return { count: 0, avg: null, med: null, sd: null, best: null };
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / arr.length);
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    const mean = sum / arr.length;
    const sd = Math.round(Math.sqrt(arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length));
    const best = Math.min(...arr);
    return { count: arr.length, avg, med, sd, best };
  };

  const finish = async () => {
    setRunning(false);
    const s = computeStats(times);
    const total = deckRef.current.length || 1;
    const finalPercent = Math.round((hits / total) * 100);
    if (finalPercent >= 70) playVictory(); else playDefeat();

    // Nome público (Perfil)
    const displayName = await fetchDisplayName();

    // recordes locais
    let changed = false;
    const rec = { ...records };
    if (s.best != null && (rec.bestSingleMs == null || s.best < rec.bestSingleMs)) { rec.bestSingleMs = s.best; rec.bestSingleName = displayName || 'Você'; changed = true; }
    if (s.avg != null && (rec.bestAvgMs == null || s.avg < rec.bestAvgMs)) { rec.bestAvgMs = s.avg; rec.bestAvgName = displayName || 'Você'; changed = true; }
    if (changed) { setRecords(rec); AsyncStorage.setItem('matrizes:records', JSON.stringify(rec)).catch(() => {}); }

    // Snapshot local para RecordsHub (localKey: 'matrizes:last') + envio
    const localForRecords = {
      user_name: displayName || 'Convidado',
      score: finalPercent,      // melhor performance (percent)
      correct: hits,            // acertos
      time_ms: s.avg ?? null,   // melhor tempo médio (ms)
      created_at: new Date().toISOString(),
    };
    try { await AsyncStorage.setItem('matrizes:last', JSON.stringify(localForRecords)); } catch {}

    // Envio ao Supabase (mantém apenas o melhor por usuário)
    try {
      const ok = await saveMatricesRecord({
        displayName,
        score: finalPercent,
        correct: hits,
        time_ms: s.avg ?? null
      });
      console.log('[Matrizes] envio Supabase:', ok ? 'ok' : 'falhou');
    } catch (e) {
      console.log('[Matrizes] erro ao enviar:', e?.message || e);
    }

    setShowResults(true);
  };

  const startGame = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Combina decks local e remoto primeiro
    const localDeck = buildMatrizDeck(seriesCount);
    const remoteDeck = remoteItems || [];
    
    // Embaralha ambos os conjuntos para garantir aleatoriedade
    const combined = [...localDeck, ...remoteDeck].sort(() => Math.random() - 0.5);
    
    // Pega o número de séries desejado do deck combinado
    const deck = combined.slice(0, seriesCount);

    const localCount = deck.filter(d => !d.remote).length;
    const remoteCount = deck.filter(d => d.remote).length;

    console.log(`[MATRIZES] deck final total=${deck.length} (locais=${localCount}, remotos=${remoteCount})`);

    deckRef.current = deck;
    setIdx(0);
    setHits(0);
    setTimes([]);
    setShowIntro(false);
    setShowResults(false);
    setMidMsg(null);
    setPaused(false);
    setRunning(true);
  };

  // >>> GATING: checa limites antes de iniciar
  const iniciarComGating = useCallback(async () => {
    if (running || startingGate || remoteLoading) return;
    setStartingGate(true);
    try {
      console.log('[MATRIZES] tentarUsar MATRIZES plano=', plano);
      const r = await tentarUsar('MATRIZES', plano);
      console.log('[MATRIZES] resultado tentarUsar', r);
      if (!r.ok) {
        if (r.erro === 'nao_logado') return; // opcional: navegar para login
        if (r.erro === 'limite') { openPaywall(); return; }
        if (r.erro === 'compra_unica_necessaria') { openPaywall('MATRIZES'); return; }
        if (r.erro === 'codigo_desconhecido') { // fallback se feature não cadastrada
          startGame();
          return;
        }
        return;
      }
      // Dentro do limite → inicia
      startGame();
    } finally {
      setStartingGate(false);
    }
  }, [running, startingGate, plano, openPaywall, startGame, remoteLoading, remoteItems]);

  // Pré-carrega as imagens da próxima questão para evitar travamentos
  useEffect(() => {
    const deck = deckRef.current;
    const nextIdx = idx + 1;
    if (deck && nextIdx < deck.length) {
      const nextItem = deck[nextIdx];
      if (nextItem?.prompt?.uri) {
        Image.prefetch(nextItem.prompt.uri).catch(e =>
          console.warn(`[MATRIZES] Falha prefetch questão ${nextIdx}: ${e.message}`)
        );
      }
      if (nextItem?.options?.length) {
        nextItem.options.forEach(option => {
          if (option?.uri) {
            Image.prefetch(option.uri).catch(e =>
              console.warn(`[MATRIZES] Falha prefetch opção ${nextIdx}: ${e.message}`)
            );
          }
        });
      }
    }
  }, [idx, deckRef.current]); // Executa sempre que o índice da questão muda

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Matrizes</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={togglePause}
            disabled={showIntro || showResults || !running}
            style={styles.iconBtn}
          >
            <Feather
              name={paused ? 'play' : 'pause'}
              size={18}
              color={showIntro || showResults || !running ? '#54616b' : '#fff'}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
            <Feather name="settings" size={18} color="#b2c7d3" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Cronômetro sempre montado (não reinicia ao pausar) */}
      {running && (
        <Cronometro
          active={running && !showIntro && !showResults}
          paused={paused}
          restartKey={idx}
          onTick={(t)=>{ lastElapsedRef.current = t; }}
        />
      )}

      {/* HUD */}
      {!showIntro && !showResults && !paused && (
        <View style={styles.hud}>
          <Text style={styles.hudTxt}>Questão: {Math.min(idx + 1, deckRef.current.length)}/{deckRef.current.length}</Text>
          <Text style={styles.hudTxt}>Último: {lastRt != null ? `${lastRt} ms` : '—'}</Text>
        </View>
      )}

      {/* Corpo */}
      {!showIntro && !showResults && !paused && (
        <View style={styles.body}>
          {item && (
            <View style={styles.promptBox}>
              <Image source={item.prompt} resizeMode="contain" style={styles.promptImg} />
            </View>
          )}
          {midMsg && (
            <View style={styles.midMsgOverlay} pointerEvents="none">
              <Text style={styles.midMsgTxt}>{midMsg}</Text>
            </View>
          )}
          <View style={styles.optionsGrid}>
            {shuffled.options.map((src, i) => (
              <TouchableOpacity
                key={i}
                style={styles.option}
                onPress={() => onPick(i)}
                activeOpacity={0.88}
              >
                <Image source={src} resizeMode="contain" style={styles.optionImg} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Pausa */}
      {paused && !showIntro && !showResults && (
        <View style={styles.pauseOverlay} pointerEvents="box-none">
          <View style={styles.pauseCard} pointerEvents="auto">
            <Text style={styles.pauseTitle}>Pausado</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={styles.introBtn} onPress={togglePause} activeOpacity={0.9}>
                <Feather name="play-circle" size={20} color="#0a0f12" />
                <Text style={styles.introBtnTxt}>Retomar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.introBtn, { backgroundColor: '#ffffff15' }]} onPress={() => navigation.goBack()} activeOpacity={0.9}>
                <Feather name="arrow-left-circle" size={20} color="#ffd166" />
                <Text style={[styles.introBtnTxt, { color: '#ffd166' }]}>Voltar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Intro */}
      {showIntro && (
        <View style={styles.introOverlay} pointerEvents="box-none">
          <View style={styles.introCard} pointerEvents="auto">
            <View style={styles.introHeaderRow}>
              <Feather name="zap" size={22} color="#ffd166" />
              <Text style={styles.introTitle}>Matrizes</Text>
            </View>

            <Text style={styles.introLead}>
              Matrizes avaliam raciocínio indutivo, identificação de padrões, memória de trabalho e velocidade de processamento.
            </Text>
            <Text style={styles.introBenefit}>
              Benefício: melhora estratégia, foco e rapidez aplicadas a padrões — úteis em testes de raciocínio e tarefas que exigem detectar regularidades.
            </Text>

            <View style={styles.kicker}>
              <Text style={styles.kickerTxt}>Como jogar</Text>
            </View>
            <Text style={styles.introHow}>
              Observe a matriz e escolha a alternativa que completa corretamente a figura.
            </Text>

            <TouchableOpacity
              style={[styles.introBtn, (startingGate || remoteLoading) && { opacity: 0.5 }]}
              onPress={iniciarComGating}
              disabled={startingGate || remoteLoading}
              activeOpacity={0.9}
            >
              <Feather name="play-circle" size={20} color="#0a0f12" />
              <Text style={styles.introBtnTxt}>{startingGate ? '...' : (remoteLoading ? 'Carregando...' : 'Começar')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Configurações (sem perfil interno) */}
    <Modal visible={showSettings} transparent animationType="none" onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Partida</Text>
            <Text style={styles.label}>Número de séries</Text>
            <View style={styles.rowChips}>
              <TouchableOpacity
                style={[styles.chip, seriesCount === 10 && styles.chipSelected]}
                onPress={() => { setSeriesCount(10); AsyncStorage.setItem('matrizes:series', '10').catch(()=>{}); }}
                activeOpacity={0.9}
              >
                <Text style={[styles.chipTxt, seriesCount === 10 && styles.chipTxtSelected]}>10</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, seriesCount === 20 && styles.chipSelected]}
                onPress={() => { setSeriesCount(20); AsyncStorage.setItem('matrizes:series', '20').catch(()=>{}); }}
                activeOpacity={0.9}
              >
                <Text style={[styles.chipTxt, seriesCount === 20 && styles.chipTxtSelected]}>20</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalTitle, { marginTop: 10 }]}>Recordes do aplicativo</Text>
            <Text style={styles.label}>Clique mais rápido: {records.bestSingleMs ?? '—'} ms {records.bestSingleName ? `• ${records.bestSingleName}` : ''}</Text>
            <Text style={styles.label}>Média mais rápida: {records.bestAvgMs ?? '—'} ms {records.bestAvgName ? `• ${records.bestAvgName}` : ''}</Text>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setShowSettings(false)}>
                <Text style={styles.closeBtnTxt}>Fechar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Resultados */}
    <Modal visible={showResults} transparent animationType="none" onRequestClose={() => setShowResults(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.resultsCard}>
            {(() => {
              const total = deckRef.current.length || 1;
              const percent = Math.round((hits / total) * 100);
              const sum = times.reduce((a, b) => a + b, 0);
              const avg = times.length ? Math.round(sum / times.length) : null;
              const best = times.length ? Math.min(...times) : null;
              const confetti = percent >= 80;
              return (
                <>
                  {confetti && (
                    <Confetti
                      count={160}
                      origin={{ x: 0, y: 0 }}
                      fadeOut
                      explosionSpeed={320}
                      fallSpeed={2600}
                      colors={['#ffd166', '#00d3aa', '#f1c40f', '#ffffff', '#9ad8ff']}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
                    />
                  )}
                  <Text style={styles.resultsTitle}>Resultados</Text>
                  <Text style={styles.resLine}>Acertos: {hits}/{total} • Pontuação: {percent}%</Text>
                  <Text style={styles.resLine}>Média: {avg ?? '—'} ms • Melhor: {best ?? '—'} ms</Text>
                  <View style={styles.resultsActions}>
                    <TouchableOpacity
                      style={[styles.resBtn, styles.resBtnPrimary, startingGate && { opacity: 0.5 }]}
                      onPress={iniciarComGating}
                      disabled={startingGate}
                      activeOpacity={0.9}
                    >
                      <Feather name="refresh-ccw" size={16} color="#0a0f12" />
                      <Text style={styles.resBtnTxtPrimary}>{startingGate ? '...' : 'Jogar de novo'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={() => { setShowResults(false); setShowSettings(true); }}>
                      <Feather name="settings" size={16} color="#fff" />
                      <Text style={styles.resBtnTxtGhost}>Configurações</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.resBtn, styles.resBtnGhost]} onPress={() => { setShowResults(false); navigation.goBack(); }}>
                      <Text style={styles.resBtnTxtGhost}>Voltar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Aviso deck vazio */}
      {!showIntro && !showResults && !paused && deckRef.current.length === 0 && (
        <View style={{ padding:16 }}>
          <Text style={{ color:'#ff9f9f', textAlign:'center', fontWeight:'700' }}>
            Nenhum item disponível (local ou remoto). Verifique nomes dos arquivos e manifest.json.
          </Text>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 48, paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 6 },
  title: { fontSize: 20, color: '#fff', fontWeight: '800' },

  hud: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, marginBottom: 6 },
  hudTxt: { color: '#b2c7d3', fontSize: 12 },

  // Pausa
  pauseOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', zIndex: 11 },
  pauseCard: { width: '80%', backgroundColor: 'rgba(20,25,35,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 18 },
  pauseTitle: { color: '#ffd166', fontSize: 18, fontWeight: '800', textAlign: 'center' },

  // Config chips
  rowChips: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff22' },
  chipSelected: { backgroundColor: '#ffd166', borderColor: '#ffd166' },
  chipTxt: { color: '#e6f0ff', fontWeight: '700' },
  chipTxtSelected: { color: '#0a0f12' },

  body: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  promptBox: {
    alignSelf: 'center', width: '94%', aspectRatio: 1,
    backgroundColor: '#ffffff10', borderRadius: 14, borderWidth: 1, borderColor: '#ffffff22',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 10
  },
  promptImg: { width: '100%', height: '100%' },

  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  option: {
    width: '32%', aspectRatio: 1,
    backgroundColor: '#ffffff10', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff22',
    marginBottom: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
  },
  optionImg: { width: '100%', height: '100%' },

  crono: {
    position: 'absolute', right: 10, bottom: 10, backgroundColor: '#00000055',
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ffffff22', zIndex: 5
  },
  cronoTxt: { color: '#ffd166', fontWeight: '800', fontSize: 14 },

  midMsgOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  midMsgTxt: { color: '#d1e8ff', backgroundColor: '#00000055', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, fontSize: 18, fontWeight: '800', textAlign: 'center' },

  // Intro
  introOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', zIndex: 10
  },
  introCard: {
    width: '92%', maxWidth: 520,
    backgroundColor: 'rgba(13,18,28,0.96)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20, padding: 20
  },
  introHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  introTitle: { color: '#ffd166', fontSize: 20, fontWeight: '800', marginLeft: 8, textAlign: 'center' },
  introLead: { color: '#dbeaff', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 8 },
  introBenefit: { color: '#b2c7d3', fontSize: 13, lineHeight: 20, textAlign: 'center', fontStyle: 'italic', marginBottom: 14 },

  kicker: { alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#ffd166', borderRadius: 999, marginBottom: 8 },
  kickerTxt: { color: '#0a0f12', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 },

  introHow: { color: '#e6f0ff', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 14 },

  introBtn: { backgroundColor: '#00d3aa', paddingVertical: 12, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  introBtnTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 16, marginLeft: 8 },

  // Modais
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '90%', backgroundColor: 'rgba(16,24,40,1)', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  label: { color: '#b2c7d3', fontSize: 13 },
  closeBtn: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#ffffff10', borderRadius: 12 },
  closeBtnTxt: { color: '#fff', fontWeight: '700' },

  resultsCard: { width: '90%', backgroundColor: '#101828', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  resultsTitle: { color: '#fff', fontWeight: '800', fontSize: 18, marginBottom: 8, alignSelf: 'center' },
  resLine: { color: '#fff', fontSize: 14, textAlign: 'center', marginTop: 4 },
  resultsActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 10, flexWrap: 'wrap' },
  resBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  resBtnPrimary: { backgroundColor: '#00d3aa' },
  resBtnGhost: { backgroundColor: '#ffffff10' },
  resBtnTxtPrimary: { color: '#0a0f12', fontWeight: '800', marginLeft: 8 },
  resBtnTxtGhost: { color: '#fff', fontWeight: '700', marginLeft: 8 },
});