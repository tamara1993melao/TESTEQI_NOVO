import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, ActivityIndicator, Image, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../../planoContext';
import { tentarUsar } from '../../core/gatingLocal';
import { usePaywall } from '../../paywallContext';
import { enviarRespostaDesafio } from './serviceDesafio';
import { Confetti } from '../../components/Confetti'; // ADICIONE (ajuste caminho se necessário)
import { Audio } from 'expo-av';

const ATTEMPT_LIMIT = 3; // <-- ADICIONAR NO TOPO (fora do componente)

// --- Hook simples para sons (vitória / derrota) ---
function useFeedbackSounds() {
  const soundsRef = useRef({ win: null, lose: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
        const win = new Audio.Sound();
        const lose = new Audio.Sound();
        await win.loadAsync(require('../../assets/vitoria.mp3'));
        await lose.loadAsync(require('../../assets/derrota.mp3'));
        if (mounted) {
          soundsRef.current.win = win;
          soundsRef.current.lose = lose;
          setLoaded(true);
        }
      } catch {}
    })();
    return () => {
      Object.values(soundsRef.current).forEach(snd => {
        if (snd) snd.unloadAsync().catch(()=>{});
      });
    };
  }, []);
  async function play(kind) {
    const s = soundsRef.current[kind];
    if (!s) return;
    try { await s.stopAsync(); await s.setPositionAsync(0); await s.playAsync(); } catch {}
  }
  return { playWin: () => play('win'), playLose: () => play('lose'), loaded };
}

export default function DesafioDetalhe({ route, navigation }) {
  const { id } = route.params;
  const [desafio, setDesafio] = useState(null);
  const [resposta, setResposta] = useState('');
  const [loadingSend, setLoadingSend] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [tentativas, setTentativas] = useState([]);
  const [msgEstado, setMsgEstado] = useState(null);   // {type:'info'|'ok'|'warn'|'err', text:string}
  const [ultima, setUltima] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showImgModal, setShowImgModal] = useState(false);
  const [imgLoadingFull, setImgLoadingFull] = useState(false);
  const confettiKey = useRef(0);
  const { playWin, playLose } = useFeedbackSounds();
  // >>> GATING hooks
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();
  // ADICIONE a ref de consumo de gating por desafio
  const gatingConsumedRef = useRef(false);

  async function carregar() {
    setCarregando(true);
    const { data: ch } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', id)
      .single();
    setDesafio(ch || null);

    // Carrega tentativas do usuário atual
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (uid) {
      const { data: subs } = await supabase
        .from('challenge_submissions')
        .select('id,created_at,is_correct,auto_evaluated')
        .eq('challenge_id', id)
        .eq('user_id', uid)
        .order('created_at', { ascending: true });
      setTentativas(subs || []);
      setUltima(subs?.length ? subs[subs.length - 1] : null);
    } else {
      setTentativas([]);
      setUltima(null);
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, [id]);

  const expirado = useMemo(
    () => !!desafio && new Date(desafio.deadline) < new Date(),
    [desafio]
  );

  const attemptsUsed = tentativas.length;
  const hasCorrect = tentativas.some(t => t.is_correct);
  const remaining = hasCorrect ? 0 : Math.max(0, ATTEMPT_LIMIT - attemptsUsed);
  const podeResponder = !carregando && desafio && !expirado && remaining > 0 && !hasCorrect;

  useEffect(() => {
    if (hasCorrect) {
      setMsgEstado({ type: 'ok', text: 'Você já concluiu este desafio. Parabéns!' });
      return;
    }
    if (attemptsUsed === 0) { setMsgEstado(null); return; }
    if (attemptsUsed < ATTEMPT_LIMIT) {
      setMsgEstado({
        type: 'warn',
        text: `Resposta incorreta. Você tem mais ${remaining} tentativa${remaining === 1 ? '' : 's'}.`
      });
      return;
    }
    if (attemptsUsed >= ATTEMPT_LIMIT) {
      setMsgEstado({ type: 'err', text: 'Limite de tentativas atingido.' });
    }
  }, [attemptsUsed, hasCorrect, remaining]);

  const tempoRestante = useMemo(() => {
    if (!desafio) return '';
    const diff = new Date(desafio.deadline) - new Date();
    if (diff <= 0) return 'Encerrado';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return `${d}d ${h % 24}h restantes`;
    }
    if (h > 0) return `${h}h ${m}m restantes`;
    return `${m}m restantes`;
  }, [desafio]);

  async function enviar() {
    if (!resposta.trim() || !podeResponder) return;

    // >>> GATING (DESAFIO_RESP) – só na PRIMEIRA submissão de um desafio
    if (attemptsUsed === 0 && !gatingConsumedRef.current) {
      gatingConsumedRef.current = true; // marca para evitar duplo clique contar 2x
      try {
        const r = await tentarUsar('DESAFIO_RESP', plano);
        console.log('[DESAFIO][gating] DESAFIO_RESP resultado', r);
        if (!r.ok) {
          // Se bloqueado, libera ref para tentar depois (ex: após assinar)
          gatingConsumedRef.current = false;
          if (r.erro === 'nao_logado') {
            navigation.navigate && navigation.navigate('Login');
            return;
          }
          if (r.erro === 'limite') {
            openPaywall();
            setMsgEstado({ type: 'err', text: 'Limite gratuito de desafios atingido. Assine para continuar.' });
            return;
          }
          if (r.erro === 'compra_unica_necessaria') {
            openPaywall('DESAFIO_RESP');
            return;
          }
          if (r.erro === 'codigo_desconhecido') {
            // fallback: permite enviar normalmente
          } else {
            return; // outros erros silenciam
          }
        }
      } catch (e) {
        console.log('[DESAFIO][gating] erro inesperado', e);
        // Falha de gating: segue envio para não bloquear
      }
    }

    setLoadingSend(true);
    try {
      const r = await enviarRespostaDesafio(id, resposta.trim());
      // Atualiza estado local
      const novasTent = [...tentativas, r];
      setTentativas(novasTent);
      setUltima(r);

      if (r.is_correct) {
        playWin();
        confettiKey.current += 1;
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3500);
        setMsgEstado({ type: 'ok', text: 'Resposta correta! Desafio concluído.' });
      } else if (r.auto_evaluated) {
        playLose();
        const left = ATTEMPT_LIMIT - novasTent.length;
        setMsgEstado(left > 0
          ? { type: 'warn', text: `Resposta incorreta. Você tem mais ${left} tentativa${left === 1 ? '' : 's'}.` }
          : { type: 'err', text: 'Resposta incorreta. Limite de tentativas atingido.' });
      } else {
        setMsgEstado({ type: 'info', text: 'Resposta registrada. Aguardando correção.' });
      }
      setResposta('');
    } catch (e) {
      const msg = (e?.message || '').toUpperCase();
      if (msg.includes('ALREADY_CORRECT')) {
        setMsgEstado({ type: 'ok', text: 'Você já concluiu este desafio.' });
      } else if (msg.includes('MAX_ATTEMPTS')) {
        setMsgEstado({ type: 'err', text: 'Limite de tentativas atingido.' });
      } else {
        setMsgEstado({ type: 'err', text: 'Erro ao enviar. Tente novamente.' });
      }
    } finally {
      setLoadingSend(false);
    }
  }

  function renderEstado() {
    if (!msgEstado) return null;
    const map = {
      ok: { bg: '#1f3d2c', border: '#2e6a46', icon: 'check-circle', color: '#4caf50' },
      warn: { bg: '#3a2f14', border: '#6d5b25', icon: 'alert-triangle', color: '#ffb74d' },
      err: { bg: '#43242a', border: '#7a3a45', icon: 'x-circle', color: '#f44336' },
      info: { bg: '#1d3742', border: '#2f5968', icon: 'info', color: '#9ad8ff' }
    };
    const cfg = map[msgEstado.type] || map.info;
    return (
      <View style={[styles.stateBox, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
        <Feather name={cfg.icon} size={18} color={cfg.color} style={{ marginRight: 8 }} />
        <Text style={[styles.stateTxt, { color: cfg.color }]}>{msgEstado.text}</Text>
      </View>
    );
  }

  // Remove bloco de log repetitivo e substitui por memo da URL
  const desafioImageUrl = useMemo(() => {
    if (!desafio?.image_path) return null;
    const raw = desafio.image_path.trim();
    if (/^https?:\/\//i.test(raw)) return raw; // já é URL completa
    const clean = raw.replace(/^desafios\//,'');
    return supabase.storage.from('desafios').getPublicUrl(clean).data.publicUrl;
  }, [desafio?.image_path]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f2027' }} edges={['top', 'bottom', 'left', 'right']}>
      <LinearGradient
        colors={Platform.select({
          android: ['#0f2027', '#183344', '#2c5364'],
          ios: ['#0f2027', '#203a43', '#2c5364'],
          default: ['#0f2027', '#203a43', '#2c5364']
        })}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Desafio</Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollPad}
            keyboardShouldPersistTaps="handled"
          >
            {/* Carregando */}
            {carregando && (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.loadingTxt}>Carregando desafio...</Text>
              </View>
            )}

            {/* Não encontrado */}
            {!carregando && !desafio && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Desafio não encontrado</Text>
                <Text style={styles.emptySub}>Volte e tente novamente.</Text>
              </View>
            )}

            {/* Principal */}
            {desafio && (
              <View style={styles.card}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, expirado ? styles.badgeRed : styles.badgeGreen]}>
                    <Text style={styles.badgeTxt}>{expirado ? 'ENCERRADO' : 'ATIVO'}</Text>
                  </View>
                  <View style={[styles.timePill, expirado && { backgroundColor: '#452b2b' }]}>
                    <Feather name="clock" size={14} color="#9ad8ff" />
                    <Text style={styles.timePillTxt}>{tempoRestante}</Text>
                  </View>
                  <View style={styles.attemptPill}>
                    <Feather name="repeat" size={14} color="#ffb74d" />
                    <Text style={styles.attemptTxt}>
                      {hasCorrect
                        ? 'Concluído'
                        : `${remaining} de ${ATTEMPT_LIMIT} restante${remaining === 1 ? '' : 's'}`}
                    </Text>
                  </View>
                </View>

                {!!desafioImageUrl && (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => setShowImgModal(true)}
                    style={{ marginBottom:14 }}
                  >
                    <Image
                      source={{ uri: desafioImageUrl }}
                      style={{ width: '100%', height: 180, borderRadius: 14 }}
                      resizeMode="cover"
                    />
                    <View style={{
                      position:'absolute', right:8, bottom:8,
                      backgroundColor:'#00000070', paddingHorizontal:10, paddingVertical:6,
                      borderRadius:20, flexDirection:'row', alignItems:'center', gap:6
                    }}>
                      <Feather name="maximize-2" size={14} color="#fff" />
                      <Text style={{ color:'#fff', fontSize:12, fontWeight:'600' }}>Ver inteira</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <Text style={styles.question}>{desafio.question}</Text>
                <Text style={styles.deadline}>Prazo: {new Date(desafio.deadline).toLocaleString()}</Text>

                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Instruções</Text>
                  <Text style={styles.instructions}>{desafio.answer_instructions}</Text>
                </View>

                {renderEstado()}

                {podeResponder && (
                  <View style={styles.answerBox}>
                    <Text style={styles.answerLabel}>Sua resposta</Text>
                    <TextInput
                      value={resposta}
                      onChangeText={setResposta}
                      placeholder="Digite aqui..."
                      placeholderTextColor="#6d8290"
                      style={styles.input}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                    />
                    <TouchableOpacity
                      disabled={loadingSend || !resposta.trim()}
                      onPress={enviar}
                      activeOpacity={0.85}
                      style={[
                        styles.sendBtn,
                        (loadingSend || !resposta.trim()) && { opacity: 0.5 }
                      ]}
                    >
                      {loadingSend
                        ? <ActivityIndicator color="#0a0f12" />
                        : <Text style={styles.sendTxt}>Enviar</Text>}
                    </TouchableOpacity>
                  </View>
                )}

                {!podeResponder && !carregando && !hasCorrect && attemptsUsed >= ATTEMPT_LIMIT && (
                  <View style={[styles.answerBox, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                    <Text style={[styles.answerLabel, { marginBottom: 4 }]}>Limite atingido</Text>
                    <Text style={styles.expiredTxt}>Você usou todas as tentativas deste desafio.</Text>
                  </View>
                )}

                {expirado && (
                  <View style={[styles.answerBox, { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
                    <Text style={[styles.answerLabel, { marginBottom: 4 }]}>Período encerrado</Text>
                    <Text style={styles.expiredTxt}>Este desafio não aceita mais respostas.</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {showConfetti && (
          <Confetti count={160} duration={4500} />
        )}

        <Modal
          visible={showImgModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImgModal(false)}
        >
          <View style={{ flex:1, backgroundColor:'#000' }}>
            <TouchableOpacity
              style={{ position:'absolute', top:40, right:20, padding:10, zIndex:10 }}
              onPress={() => setShowImgModal(false)}
              activeOpacity={0.7}
            >
              <Feather name="x" size={28} color="#fff" />
            </TouchableOpacity>
            {/* Área central */}
            <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
              {!!desafioImageUrl && (
                <Image
                  source={{ uri: desafioImageUrl }}
                  style={{ width:'100%', height:'100%' }}
                  resizeMode="contain"
                />
              )}
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal:14, paddingTop:8, paddingBottom:6, flexDirection:'row', alignItems:'center' },
  headerBtn: { padding:6 },
  headerTitle: { color:'#fff', fontSize:22, fontWeight:'900', flex:1, marginHorizontal:8 },
  headerSpacer: { width:28 },
  scrollPad: { paddingHorizontal:16, paddingBottom:40 },

  loadingBox: { marginTop:40, alignItems:'center' },
  loadingTxt: { color:'#b2c7d3', marginTop:12 },

  emptyCard: { marginTop:40, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:16, padding:20, borderWidth:1, borderColor:'rgba(255,255,255,0.12)' },
  emptyTitle: { color:'#fff', fontSize:16, fontWeight:'700' },
  emptySub: { color:'#b2c7d3', marginTop:8, lineHeight:18 },

  card: { marginTop:16, backgroundColor:'rgba(255,255,255,0.04)', borderRadius:18, padding:18, borderWidth:1, borderColor:'rgba(255,255,255,0.10)' },

  badgeRow: { flexDirection:'row', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:8 },
  badge: { paddingHorizontal:10, paddingVertical:4, borderRadius:8 },
  badgeGreen: { backgroundColor:'#214d39' },
  badgeRed: { backgroundColor:'#5a2b2b' },
  badgeTxt: { color:'#fff', fontSize:11, fontWeight:'700', letterSpacing:1 },

  timePill: { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#1d3742', paddingHorizontal:10, paddingVertical:5, borderRadius:999 },
  timePillTxt: { color:'#9ad8ff', fontSize:12, fontWeight:'600' },

  attemptPill: { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#3a2f14', paddingHorizontal:10, paddingVertical:5, borderRadius:999 },
  attemptTxt: { color:'#ffb74d', fontSize:12, fontWeight:'600' },

  question: { color:'#fff', fontSize:20, fontWeight:'800', lineHeight:26 },
  deadline: { color:'#9ad8ff', fontSize:12, marginTop:10 },

  section: { marginTop:18 },
  sectionLabel: { color:'#e7f6ff', fontWeight:'800', fontSize:12, letterSpacing:1, marginBottom:6 },
  instructions: { color:'#d1e8ff', lineHeight:22, fontSize:15 },

  stateBox: { flexDirection:'row', alignItems:'center', marginTop:18, padding:12, borderRadius:12, borderWidth:1 },
  stateTxt: { flex:1, fontSize:13, fontWeight:'600', lineHeight:18 },

  answerBox: { marginTop:24, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:14, padding:16, borderWidth:1, borderColor:'rgba(255,255,255,0.12)' },
  answerLabel: { color:'#e7f6ff', fontWeight:'700', fontSize:14, letterSpacing:0.5 },
  input: { marginTop:14, backgroundColor:'#ffffff10', borderWidth:1, borderColor:'rgba(255,255,255,0.18)', color:'#fff', padding:12, borderRadius:10, fontSize:15, minHeight:54 },
  sendBtn: { marginTop:14, backgroundColor:'#ff8fa3', paddingVertical:14, borderRadius:10, alignItems:'center' },
  sendTxt: { color:'#121216', fontWeight:'700', fontSize:15 },

  expiredTxt: { color:'#b2c7d3', lineHeight:20 }
});