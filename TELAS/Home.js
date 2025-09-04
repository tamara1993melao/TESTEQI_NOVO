import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Animated, Easing, ScrollView, FlatList, StatusBar, Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { registerForPushNotificationsAsync, onInboxChange, getInbox, markInboxRead, enviarPushTeste, watchQueueToInbox, unwatchQueueToInbox, syncInboxFromServer } from '../utils/notifications';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabaseClient';
import { obterDesafioAtivo } from './Desafio/serviceDesafio';
import { useEntitlements } from '../entitlementsContext';
import PaywallModal from './PaywallModal';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FRASES = [
  'Sua mente é seu maior ativo.',
  'Desafie-se todos os dias.',
  'Aprender é um superpoder.',
  'Pensar diferente muda tudo.',
  'Pequenos avanços geram grandes resultados.',
  'Curiosidade é a faísca da inteligência.'
];

const FONT_SIZE_CARD_TITLE = Platform.OS === 'android' ? 15 : 18;
const FONT_SIZE_CARD_CAP = Platform.OS === 'android' ? 8 : 10;
const FONT_SIZE_MENU = Platform.OS === 'android' ? 10 : 12;
const FONT_SIZE_APP_NAME = Platform.OS === 'android' ? 18 : 22;
const FONT_SIZE_BUTTON = Platform.OS === 'android' ? 10 : 16;
const FONT_SIZE_QUOTE = Platform.OS === 'android' ? 10 : 16;
const FONT_SIZE_GOAL = Platform.OS === 'android' ? 8 : 13;
const FONT_SIZE_PROGRESS = Platform.OS === 'android' ? 8 : 12;
const FONT_SIZE_RANK_HINT = Platform.OS === 'android' ? 8 : 12;
const FONT_SIZE_BENEFIT = Platform.OS === 'android' ? 10 : 12;

const SEEN_COUNT_KEY = 'inbox:seenCount';
const HIDDEN_IDS_KEY = 'inbox:hiddenIds'; // ids ocultados localmente

// Util: calcula unread baseado na contagem de itens já vistos
async function computeUnread(list) {
  try {
    const seenCountRaw = await AsyncStorage.getItem(SEEN_COUNT_KEY);
    const seenCount = seenCountRaw ? Number(seenCountRaw) : 0;
    const unreadCount = list.length - seenCount;
    return Math.max(0, unreadCount);
  } catch {
    return 0;
  }
}

// (Mantido – não usado; não alterar mais nada conforme pedido)
async function persistLastSeen(list) {
  const maxId = list.reduce((m, n) => {
    const idNum = Number(n.id);
    return !isNaN(idNum) && idNum > m ? idNum : m;
  }, 0);
  if (maxId > 0) {
    await AsyncStorage.setItem(LAST_SEEN_ID_KEY, String(maxId));
  }
}

async function persistSeenCount(list) {
  try {
    await AsyncStorage.setItem(SEEN_COUNT_KEY, String(list.length));
  } catch (e) {
    console.error("Falha ao salvar contagem de vistos:", e);
  }
}

// ------ HIDING HELPERS ------
async function getHiddenIds() {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function addHiddenId(id) {
  try {
    const ids = await getHiddenIds();
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      await AsyncStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify(ids));
    }
  } catch {}
}
// ----------------------------

export default function Home({ navigation }) {
  const insets = useSafeAreaInsets();

  const fraseDoDia = useMemo(() => {
    const indice = new Date().getDate() % FRASES.length;
    return FRASES[indice];
  }, []);

  const brainScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(brainScale, { toValue: 1.06, duration: 1600, useNativeDriver: true }),
        Animated.timing(brainScale, { toValue: 1, duration: 1600, useNativeDriver: true })
      ])
    ).start();
  }, [brainScale]);

  const ctaPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(ctaPulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      })
    ).start();
  }, [ctaPulse]);
  const ctaScale = ctaPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  const [goalProgress, setGoalProgress] = useState(0);
  const [weeklyGoal, setWeeklyGoal] = useState(3);
  const [completedWeek, setCompletedWeek] = useState(0);

  const irParaTreinos = () => navigation.navigate('Testes');
  const irParaResultados = () => navigation.navigate('RecordsHub');
  const irParaPerfil = () => navigation.navigate('Perfil');
  const irParaNoticias = () => navigation.navigate('NoticiasHub');
  const irParaSobre = () => navigation.navigate('Sobre');
  const irParaRecordes = () => navigation.navigate('RecordsHub');
  const irParaClassificacao = () => navigation.navigate('ClassificacaoQI');

  const [unread, setUnread] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [desafioAtivo, setDesafioAtivo] = useState(null);
  const [loadingDesafio, setLoadingDesafio] = useState(true);
  const { premium } = useEntitlements();
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    registerForPushNotificationsAsync().catch(()=>{});
    watchQueueToInbox();
    syncInboxFromServer().catch(()=>{});

    (async () => {
      try {
        const items = await getInbox();
        const sorted = sortInbox(items);
        const hidden = await getHiddenIds();
        const visible = sorted.filter(n => !hidden.includes(String(n.id)));
        setInbox(visible);
        setUnread(await computeUnread(visible));
      } catch {}
    })();

    const unsub = onInboxChange(async () => {
      try {
        const items = await getInbox();
        const sorted = sortInbox(items);
        const hidden = await getHiddenIds();
        const visible = sorted.filter(n => !hidden.includes(String(n.id)));
        setInbox(visible);
        setUnread(await computeUnread(visible));
      } catch {}
    });

    return () => {
      unsub && unsub();
      unwatchQueueToInbox();
    };
  }, []);

  useFocusEffect(React.useCallback(() => {
    syncInboxFromServer();
  }, []));

  const sortInbox = useCallback(list => list.slice().sort((a,b)=> b.ts - a.ts), []);

  const openInbox = useCallback(async () => {
    const items = await getInbox();
    const sorted = sortInbox(items);
    const hidden = await getHiddenIds();
    const visible = sorted.filter(n => !hidden.includes(String(n.id)));
    setInbox(visible);
    setInboxOpen(true);
    await markInboxRead().catch(()=>{});
    await persistSeenCount(visible);
    setUnread(0);
  }, [sortInbox]);

  const closeInbox = useCallback(() => setInboxOpen(false), []);

  // NOVO: remover notificação individual do modal (não altera backend, apenas a visualização local)
  const dismissNotification = useCallback((id) => {
    // Remove da lista atual e persiste ocultação
    setInbox(prev => prev.filter(n => n.id !== id));
    addHiddenId(id);
  }, []);

  const onTestPush = React.useCallback(() => {
    enviarPushTeste().catch(console.warn);
  }, []);

  async function loadWeeklyProgress() {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        setGoalProgress(0);
        setCompletedWeek(0);
        return;
      }
      const { data, error } = await supabase.rpc('util_obter_meta_semana');
      if (error) throw error;
      if (data?.erro === 'nao_autenticado') {
        setGoalProgress(0);
        return;
      }
      const meta = Number(data.meta) || 3;
      const concl = Number(data.concluidos) || 0;
      setWeeklyGoal(meta);
      setCompletedWeek(concl);
      setGoalProgress(meta > 0 ? Math.min(1, concl / meta) : 0);
    } catch (e) {
      console.log('[MetasSemana]', e?.message || e);
      setGoalProgress(0);
    }
  }

  useEffect(() => { loadWeeklyProgress(); }, []);
  useFocusEffect(React.useCallback(() => { loadWeeklyProgress(); }, []));

  useEffect(() => {
    (async () => {
      setLoadingDesafio(true);
      setDesafioAtivo(await obterDesafioAtivo());
      setLoadingDesafio(false);
    })();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <PaywallModal
        visible={showPaywall}
        onClose={()=> setShowPaywall(false)}
      />

      <StatusBar translucent={false} backgroundColor="transparent" barStyle="light-content" />
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        <View style={styles.header}>
          <View className="brandRow" style={styles.brandRow}>
            <Image source={require('../assets/icon.png')} style={styles.logo} />
            <View>
              <Text style={styles.appName}>Sigma Society</Text>
              <Text style={styles.tagline}>Treine a mente diariamente</Text>
            </View>
          </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity onPress={openInbox} style={styles.bellBtn} activeOpacity={0.85}>
                <Feather name="bell" size={20} color="#fff" />
                {unread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={irParaPerfil} style={styles.profileBtn} activeOpacity={0.85}>
                <Feather name="user" size={18} color="#fff" />
                <Text style={styles.profileTxt}>Perfil</Text>
              </TouchableOpacity>
            </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.quote}>"{fraseDoDia}"</Text>

          <LinearGradient colors={['#1e3c72', '#2a5298']} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.hero}>
            <View style={styles.heroLeft}>
              <Text style={styles.heroTitle}>Treinos de Inteligência</Text>
              <Text style={styles.heroSubtitle}>
                Melhore lógica, atenção, memória e foco com sessões rápidas.
              </Text>

              <Animated.View style={{ transform: [{ scale: ctaScale }], marginTop: 12 }}>
                <TouchableOpacity style={styles.ctaPrimary} onPress={irParaTreinos} activeOpacity={0.9}>
                  <Feather name="zap" size={18} color="#0a0f12" />
                  <Text style={styles.ctaPrimaryTxt} numberOfLines={1} ellipsizeMode="tail">Treinar agora</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

            <Animated.Image
              source={require('../assets/brain.png')}
              style={[styles.brainImage, { transform: [{ scale: brainScale }] }]}
              resizeMode="contain"
            />
          </LinearGradient>

          <View style={styles.benefitsRow}>
            <View style={styles.benefitChip}>
              <Feather name="cpu" size={14} color="#9ad8ff" />
              <Text style={styles.benefitTxt} numberOfLines={2} ellipsizeMode="tail">Lógica</Text>
            </View>
            <View style={styles.benefitChip}>
              <Feather name="clock" size={14} color="#ffd166" />
              <Text style={styles.benefitTxt}>Atenção</Text>
            </View>
            <View style={styles.benefitChip}>
              <Feather name="layers" size={14} color="#00d3aa" />
              <Text style={styles.benefitTxt}>Memória</Text>
            </View>
            <View style={styles.benefitChip}>
              <Feather name="target" size={14} color="#ff8fa3" />
              <Text style={styles.benefitTxt}>Foco</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="trending-up" size={16} color="#00d3aa" />
                <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">Metas da semana</Text>
              </View>
              <Text style={[styles.cardCap, styles.cardCapRight]}>Evolua</Text>
            </View>

            <Text style={styles.goalTxt}>Complete suas sessões de treino desta semana</Text>

            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.round(goalProgress * 100)}%` }]} />
            </View>
            <Text style={styles.progressVal}>{Math.round(goalProgress * 100)}% concluído</Text>

            <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', columnGap: 24 }}>
              {Array.from({ length: Math.min(weeklyGoal, 7) }, (_, i) => {
                const n = i + 1;
                const done = completedWeek >= n;
                return (
                  <View
                    key={n}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      width: weeklyGoal > 4 ? '45%' : '100%'
                    }}
                  >
                    <Feather
                      name="check-circle"
                      size={16}
                      color={done ? '#00d3aa' : '#ffffff55'}
                    />
                    <Text style={styles.goalItem}>{n}º treino concluído</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="book-open" size={16} color="#9ad8ff" />
                <Text style={styles.cardTitle}>Notícias</Text>
              </View>
              <Text style={[styles.cardCap, styles.cardCapRight]}>Artigos</Text>
            </View>
            <Text style={styles.saloesTxt}>
              Leituras curtas com técnicas, estudos e insights para treinar melhor.
            </Text>
            <TouchableOpacity style={styles.ctaGhost} onPress={irParaNoticias} activeOpacity={0.9}>
              <Feather name="arrow-right-circle" size={18} color="#9ad8ff" />
              <Text style={styles.ctaGhostTxt} numberOfLines={2} ellipsizeMode="tail">Ler agora</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="flag" size={16} color="#ff8fa3" />
                <Text style={styles.cardTitle} numberOfLines={2}>Desafios</Text>
              </View>
              {desafioAtivo && (
                <Text style={[styles.cardCap, styles.cardCapRight]}>
                  Até {new Date(desafioAtivo.deadline).toLocaleDateString()}
                </Text>
              )}
            </View>

            {loadingDesafio && (
              <Text style={{ color:'#888', marginTop:8 }}>Carregando desafio...</Text>
            )}

            {!loadingDesafio && !desafioAtivo && (
              <Text style={{ color:'#d1e8ff', marginTop:8 }}>
                Nenhum desafio ativo agora. Clique para ver histórico e prepare-se!
              </Text>
            )}

            {!loadingDesafio && desafioAtivo && (
              <Text style={{ color:'#d1e8ff', marginTop:8 }} numberOfLines={3}>
                {desafioAtivo.question}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.ctaGhost, { marginTop: 12 }]}
              onPress={() => navigation.navigate('DesafioHub')}
              activeOpacity={0.9}
            >
              <Feather name="arrow-right-circle" size={18} color="#ff8fa3" />
              <Text style={[styles.ctaGhostTxt, { color:'#ff8fa3' }]}>
                {desafioAtivo ? 'Ver e responder' : 'Ver desafios'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="bar-chart-2" size={16} color="#ffd166" />
                <Text style={styles.cardTitle}>Progresso</Text>
              </View>
              <Text style={[styles.cardCap, styles.cardCapRight]}>Acompanhe sua evolução</Text>
            </View>
            <Text style={styles.progressHint}>Veja rankings e histórico detalhado.</Text>
            <TouchableOpacity style={styles.ctaGhost} onPress={irParaRecordes} activeOpacity={0.9}>
              <Feather name="arrow-right-circle" size={18} color="#ffd166" />
              <Text style={[styles.ctaGhostTxt, { color: '#ffd166' }]} numberOfLines={1} ellipsizeMode="tail">Abrir Resultados</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <MaterialCommunityIcons name="brain" size={16} color="#ffd166" />
                <Text style={styles.cardTitle}>Classificação de QI</Text>
              </View>
              <Text style={[styles.cardCap, styles.cardCapRight]}>Entenda</Text>
            </View>

            <Text style={styles.rankHint}>Faixas: 85–99 • 100–114 • 115–129 • 130+</Text>

            <TouchableOpacity style={[styles.ctaGhost, { marginTop: 10 }]} onPress={irParaClassificacao} activeOpacity={0.9}>
              <Feather name="arrow-right-circle" size={18} color="#ffd166" />
              <Text style={[styles.ctaGhostTxt, { color: '#ffd166' }]} numberOfLines={1} ellipsizeMode="tail">Abrir Classificação</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={[styles.menu, { paddingBottom: 8 + insets.bottom }]}>
          <TouchableOpacity style={styles.menuItem} onPress={irParaTreinos}>
            <Feather name="zap" size={22} color="#b2c7d3" />
            <Text style={styles.menuText}>Treinos</Text>
          </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={irParaRecordes}>
              <Feather name="award" size={22} color="#b2c7d3" />
              <Text style={styles.menuText}>Records</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={irParaSobre}>
              <Feather name="info" size={22} color="#b2c7d3" />
              <Text style={styles.menuText}>Sobre</Text>
            </TouchableOpacity>
        </View>

        {inboxOpen && (
          <View
            style={[
              styles.inboxContainer,
              {
                paddingTop: insets.top + 10,
                paddingBottom: insets.bottom + 20
              }
            ]}
            pointerEvents="auto"
          >
            <View style={styles.inboxHeader}>
              <Text style={styles.inboxTitle}>Notificações</Text>
              <TouchableOpacity onPress={closeInbox} style={styles.closeButton}>
                <Feather name="x" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={inbox}
              keyExtractor={(it) => String(it.id)}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
              renderItem={({ item }) => (
                <View style={styles.inboxItem}>
                  <Feather name="bell" size={16} color="#ffd166" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{item.title}</Text>
                    {!!item.body && <Text style={{ color: '#cfe5f0', marginTop: 2 }}>{item.body}</Text>}
                    <Text style={{ color: '#9fb7c7', fontSize: 10, marginTop: 4 }}>
                      {new Date(item.ts).toLocaleString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => dismissNotification(item.id)}
                    style={styles.inboxDismissBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#cfe5f0', textAlign: 'center', marginTop: 20 }}>
                  Nenhuma notificação
                </Text>
              }
            />
          </View>
        )}

      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f2027' },
  gradient: { flex: 1, paddingHorizontal: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 8,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 12 },
  appName: { fontSize: FONT_SIZE_APP_NAME, color: '#fff', fontWeight: '900', letterSpacing: 0.3 },
  tagline: { color: '#cfe5f099', fontSize: 12, marginTop: 2 },
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#ffffff18',
    borderWidth: 1,
    borderColor: '#ffffff22',
  },
  profileTxt: { color: '#fff', fontWeight: '700' },
  bellBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff18', borderWidth: 1, borderColor: '#ffffff22' },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#ff4757', borderRadius: 10, paddingHorizontal: 5, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0008' },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '900' },
  scroll: { paddingBottom: 16 },
  quote: {
    marginTop: 10,
    marginBottom: 12,
    color: '#c8f7ff',
    fontSize: FONT_SIZE_QUOTE,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 10,
  },
  hero: {
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroLeft: { flex: 1, paddingRight: 8 },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.3 },
  heroSubtitle: { color: '#e1f5f8', fontSize: 13, marginTop: 6 },
  ctaPrimary: {
    backgroundColor: '#ffd166',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minWidth: 0,
    flexShrink: 1,
  },
  ctaPrimaryTxt: {
    color: '#0a0f12',
    fontWeight: '900',
    fontSize: FONT_SIZE_BUTTON,
    flexShrink: 1,
    minWidth: 0,
  },
  brainImage: {
    width: 120,
    height: 120,
    opacity: 0.95,
  },
  benefitsRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' },
  benefitChip: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    minWidth: 0,
    flexShrink: 1,
  },
  benefitTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: FONT_SIZE_BENEFIT,
    flexShrink: 0,
    minWidth: 0,
  },
  card: {
    marginTop: 14,
    backgroundColor: 'rgba(8,12,20,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  cardTitle: {
    color: '#fff',
    fontWeight: '900',
    fontSize: FONT_SIZE_CARD_TITLE,
    flexShrink: 1,
    minWidth: 0,
  },
  cardCap: { color: '#9ad8ffcc', fontSize: FONT_SIZE_CARD_CAP },
  cardCapRight: { flexShrink: 1, textAlign: 'right' },
  goalTxt: { color: '#d9f2ff', marginTop: 8, marginBottom: 8, fontSize: FONT_SIZE_GOAL },
  progressBar: { height: 8, backgroundColor: '#ffffff18', borderRadius: 10, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#00d3aa', borderRadius: 10 },
  progressVal: { color: '#b2c7d3', fontSize: FONT_SIZE_PROGRESS, marginTop: 6 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  goalItem: { color: '#e7f6ff' },
  saloesTxt: { color: '#d1e8ff', marginTop: 8, marginBottom: 10 },
  ctaGhost: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff12',
    borderWidth: 1,
    borderColor: '#ffffff22',
    borderRadius: 999,
    paddingHorizontal: 30,
    paddingVertical: 8,
    minWidth: 0,
  },
  ctaGhostTxt: {
    color: '#9ad8ff',
    fontWeight: '800',
    fontSize: FONT_SIZE_BUTTON,
    flexShrink: 1,
    minWidth: 0,
  },
  progressHint: { color: '#cfe5f0', marginTop: 8, marginBottom: 8 },
  menu: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    backgroundColor: '#1c2e3a',
    paddingTop: 10,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: '#ffffff1A',
    justifyContent: 'space-around',
  },
  menuItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  menuText: { color: '#b2c7d3', fontSize: FONT_SIZE_MENU, fontWeight: '600', marginTop: 4 },
  menuActive: { color: '#00d3aa', fontSize: 12, fontWeight: '800', marginTop: 4 },
  rankHint: { color: '#ffd166', fontSize: FONT_SIZE_RANK_HINT, marginTop: 8, textAlign: 'center' },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#14212b',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
  },
  inboxItem: {
    flexDirection: 'row',
    backgroundColor: '#ffffff10',
    borderWidth: 1,
    borderColor: '#ffffff15',
    padding: 10,
    borderRadius: 12,
    alignItems: 'flex-start'
  },
  inboxContainer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,32,39,0.97)',
    padding: 20,
    zIndex: 999,
    elevation: 999,
  },
  inboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  closeButton: {
    padding: 5,
  },
  inboxTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  inboxDismissBtn: {
    marginLeft: 8,
    padding: 4,
    alignSelf: 'flex-start'
  },
  badgeTxtSmall: { color: '#fff', fontSize: 10 },
});

if (Platform.OS === 'android') {
  if (!Text.defaultProps) Text.defaultProps = {};
  Text.defaultProps.allowFontScaling = false;
}
