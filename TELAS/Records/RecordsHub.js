import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabaseClient';
import { RECORD_GAMES } from './recordsMap';

export default function RecordsHub({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('globais'); // 'globais' | 'pessoais'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Perfil exibido no topo
  const [profile, setProfile] = useState({
    displayName: '',
    name: '',
    nickname: '',
    birth_date: null, // 'YYYY-MM-DD'
  });

  // Nome usado para consultar "Meus" recordes (user_name na base)
  const [profileName, setProfileName] = useState('');

  const [globalData, setGlobalData] = useState({});
  const [personalData, setPersonalData] = useState({});
  const [localFallbacks, setLocalFallbacks] = useState({});
  const [segmentState, setSegmentState] = useState({}); // { [gameKey]: segmentValue }

  const gameEntries = useMemo(() => Object.entries(RECORD_GAMES), []);

  function formatBirthBr(d) {
    if (!d) return null;
    // aceita 'YYYY-MM-DD' ou Date
    try {
      const s = typeof d === 'string' ? d.split('T')[0] : null;
      const [yyyy, mm, dd] = s ? s.split('-') : [];
      if (!yyyy || !mm || !dd) return null;
      return `${dd.padStart(2, '0')}/${mm.padStart(2, '0')}/${yyyy}`;
    } catch { return null; }
  }

  const loadProfile = useCallback(async () => {
    try {
      // 1) Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      const user = authErr ? null : authData?.user ?? null;

      let profRow = null;
      if (user?.id) {
        // 2) Tabela profiles (Cadastro.js)
        const { data: p, error: pErr } = await supabase
          .from('profiles')
          .select('name, nickname, birth_date')
          .eq('id', user.id)
          .maybeSingle();
        if (!pErr && p) profRow = p;
      }

      // 3) Compor dados
      const meta = user?.user_metadata || {};
      const nickname = profRow?.nickname || meta.nickname || '';
      const name = profRow?.name || meta.full_name || meta.name || '';
      const birth = profRow?.birth_date || meta.birth_date || null;
      const displayName =
        nickname ||
        name ||
        (user?.email ? user.email.split('@')[0] : '') ||
        '';

      // 4) Fallback local (se não tiver login)
      if (!displayName) {
        const pLocal = await AsyncStorage.getItem('thinkfast:profile');
        const nameStorage = pLocal ? JSON.parse(pLocal)?.name : '';
        setProfile(prev => ({ ...prev, displayName: nameStorage || 'Convidado' }));
        setProfileName(nameStorage || 'Convidado');
        return;
      }

      setProfile({
        displayName,
        name: name || '',
        nickname: nickname || '',
        birth_date: birth || null,
      });
      setProfileName(displayName);
    } catch {
      // Fallback final
      setProfile({ displayName: 'Convidado', name: '', nickname: '', birth_date: null });
      setProfileName('Convidado');
    }
  }, []);

  // Inicializa segmentos padrão (primeira opção de cada jogo que tiver segments)
  useEffect(() => {
    const init = {};
    gameEntries.forEach(([key, g]) => {
      if (g.segments?.length) init[key] = g.segments[0].value;
    });
    setSegmentState(init);
  }, [gameEntries]);

  const fetchGlobal = useCallback(async () => {
    const acc = {};
    await Promise.all(
      gameEntries.map(async ([key, g]) => {
        try {
          let q = supabase.from(g.table).select(g.select);
          const limit = g.globalLimit ?? 5;
          if (g.segmentField && segmentState[key]) {
            q = q.eq(g.segmentField, segmentState[key]);
          }
          g.orders.forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
          q = q.limit(limit);
          const { data, error } = await q;
          if (error) throw error;
          acc[key] = data || [];
        } catch {
          acc[key] = [];
        }
      })
    );
    setGlobalData(acc);
  }, [gameEntries, segmentState]);

  const fetchPersonal = useCallback(async () => {
    const acc = {};
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user || null;
    const authUserId = authUser?.id || null;

    await Promise.all(
      gameEntries.map(async ([key, g]) => {
        try {
          const limit = g.personalLimit ?? 1;
          const applySegment = (g.segmentField && segmentState[key]);

          // NOVO: escolher tabela/select/orders pessoais
            const tableName = g.personalTable || g.table;
            const selectStr = g.personalSelect || g.select;
            const orders = g.personalOrders || g.orders;

          let rows = [];

          if (authUserId && selectStr.includes('user_id')) {
            let q = supabase.from(tableName).select(selectStr).eq('user_id', authUserId);
            if (applySegment) q = q.eq(g.segmentField, segmentState[key]);
            orders.forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
            q = q.limit(limit);
            const { data, error } = await q;
            if (!error && data) rows = data;
          }

          if (!rows.length && profileName) {
            let q2 = supabase.from(tableName).select(selectStr).eq('user_name', profileName);
            if (applySegment) q2 = q2.eq(g.segmentField, segmentState[key]);
            orders.forEach(o => { q2 = q2.order(o.col, { ascending: o.asc }); });
            q2 = q2.limit(limit);
            const { data: d2, error: e2 } = await q2;
            if (!e2 && d2) rows = d2;
          }

          acc[key] = rows;
        } catch {
          acc[key] = [];
        }
      })
    );
    setPersonalData(acc);
  }, [gameEntries, profileName, segmentState]);

  const loadLocalFallbacks = useCallback(async () => {
    const acc = {};
    await Promise.all(
      gameEntries.map(async ([key, g]) => {
        try {
          const raw = await AsyncStorage.getItem(g.localKey);
          acc[key] = raw ? JSON.parse(raw) : null;
        } catch {
          acc[key] = null;
        }
      })
    );
    setLocalFallbacks(acc);
  }, [gameEntries]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await loadProfile();
    await Promise.all([fetchGlobal(), fetchPersonal(), loadLocalFallbacks()]);
    setLoading(false);
  }, [fetchGlobal, fetchPersonal, loadLocalFallbacks, loadProfile]);

  useEffect(() => { loadAll(); }, []);

  // Quando trocar segmento em qualquer card, refaz as consultas (sem loading global)
  useEffect(() => {
    if (!Object.keys(segmentState).length) return;
    (async () => {
      await Promise.all([fetchGlobal(), fetchPersonal()]);
    })();
  }, [segmentState, fetchGlobal, fetchPersonal]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchGlobal(), fetchPersonal()]);
    setRefreshing(false);
  }, [fetchGlobal, fetchPersonal]);

  const renderItem = ({ item }) => {
    const [key, g] = item;
    const globals = globalData[key] || [];
    const personal = personalData[key] || []; // agora é array
    const local = localFallbacks[key] || null;
    const segValue = segmentState[key];
    const segLabel = g.segments?.find(s => s.value === segValue)?.label;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="award" size={16} color="#ffd166" />
            <Text style={styles.cardTitle}>{g.title}</Text>
          </View>
          {tab === 'globais' ? (
            g.segments?.length ? (
              <Text style={styles.cardBadge}>{segLabel}</Text>
            ) : (
              <Text style={styles.cardBadge}>
                {globals.length ? `Top ${Math.min(globals.length, g.globalLimit ?? globals.length)}` : 'Sem dados'}
              </Text>
            )
          ) : (
            <Text style={styles.cardBadge}>{profile.displayName || 'Sem perfil'}</Text>
          )}
        </View>

        {g.segments?.length ? (
          <View style={styles.segmentsRow}>
            {g.segments.map(s => {
              const active = segValue === s.value;
              return (
                <TouchableOpacity
                  key={`${key}-${s.value}`}
                  style={[styles.segmentChip, active && styles.segmentChipActive]}
                  onPress={() => setSegmentState(prev => ({ ...prev, [key]: s.value }))}
                >
                  <Text style={[styles.segmentTxt, active && styles.segmentTxtActive]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {tab === 'globais' ? (
          globals.length ? (
            <View style={{ marginTop: 6 }}>
              {globals.map((r, i) => (
                <RankRow key={`${key}-g-${i}`} pos={i + 1} name={r.user_name || '—'} metric={g.metric(r)} />
              ))}
            </View>
          ) : (
            <Empty label="Sem resultados no momento." />
          )
        ) : (
          <View style={{ marginTop: 6 }}>
            {personal.length ? (
              <View>
                {personal.map((r, i) => (
                  <RankRow
                    key={`${key}-p-${i}`}
                    pos={personal.length === 1 ? 'Seu melhor' : `${i + 1}`}
                    name={r.user_name || profile.displayName || '—'}
                    metric={g.metric(r)}
                  />
                ))}
              </View>
            ) : local ? (
              <RankRow pos="Local" name={profile.displayName || '—'} metric={formatLocalMetric(key, local)} />
            ) : (
              <Empty label="Jogue para registrar seu melhor." />
            )}
          </View>
        )}
      </View>
    );
  };

  const birthStr = formatBirthBr(profile.birth_date);

  return (
    <LinearGradient colors={['#0c1720', '#152835', '#1e3a4a']} style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { paddingBottom: Math.max(insets?.bottom ?? 0, 10) }]} edges={['top', 'left', 'right', 'bottom']}>
        {/* Header limpo */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Recordes</Text>
          <TouchableOpacity onPress={loadAll} style={styles.iconBtn}>
            <Feather name="refresh-ccw" size={18} color="#b2c7d3" />
          </TouchableOpacity>
        </View>

        {/* Perfil resumido */}
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Feather name="user" size={20} color="#0a0f12" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>{profile.displayName || 'Convidado'}</Text>
            <View style={styles.profileMetaRow}>
              {profile.nickname ? (
                <View style={styles.metaPill}>
                  <Feather name="at-sign" size={12} color="#0a0f12" />
                  <Text style={styles.metaPillTxt}>{profile.nickname}</Text>
                </View>
              ) : null}
              {birthStr ? (
                <View style={styles.metaPill}>
                  <Feather name="calendar" size={12} color="#0a0f12" />
                  <Text style={styles.metaPillTxt}>{birthStr}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate?.('Perfil')} style={[styles.iconBtn, { paddingHorizontal: 10 }]}>
            <Feather name="edit-3" size={18} color="#ffd166" />
          </TouchableOpacity>
        </View>

        {/* Abas */}
        <View style={styles.tabs}>
          <TabBtn label="Globais" active={tab === 'globais'} onPress={() => setTab('globais')} />
          <TabBtn label="Meus" active={tab === 'pessoais'} onPress={() => setTab('pessoais')} />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#fff" style={{ marginTop: 20 }} />
        ) : (
          <FlatList
            data={gameEntries}
            keyExtractor={([key]) => key}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const Empty = ({ label }) => (
  <View style={{ paddingVertical: 8 }}>
    <Text style={styles.emptyTxt}>{label}</Text>
  </View>
);

const TabBtn = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} style={[styles.tabBtn, active ? styles.tabActive : styles.tabInactive]} activeOpacity={0.9}>
    <Text style={[styles.tabTxt, active ? styles.tabTxtActive : styles.tabTxtInactive]}>{label}</Text>
  </TouchableOpacity>
);

const RankRow = ({ pos, name, metric }) => (
  <View style={styles.row}>
    <Text style={styles.pos}>{pos}</Text>
    <View style={{ flex: 1 }}>
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <Text style={styles.metric} numberOfLines={1}>{metric}</Text>
    </View>
  </View>
);

function formatLocalMetric(key, local) {
  try {
    if (key === 'adivinhe') {
      const sc = local?.score ?? local;
      const p = local?.percent;
      const t = local?.time_ms ?? local?.time;
      return `pontos ${sc ?? '—'}${p != null ? ` • ${p}%` : ''}${t != null ? ` • ${t} ms` : ''}`;
    }
    if (key === 'thinkfast' || key === 'thinkfast90') {
      const p = local?.percent ?? '—';
      const avg = local?.avg ?? local?.avg_ms ?? '—';
      const best = local?.best ?? local?.best_single_ms ?? '—';
      return `${p}% • média ${avg} ms • melhor ${best} ms`;
    }
    if (key === 'sequences') {
      const p = local?.percent ?? '—';
      const tt = local?.time_total_s ?? local?.time ?? '—';
      const avg = local?.avg_time_s ?? local?.avg ?? null;
      const avgStr = avg != null ? `${Number(avg).toFixed(1)}s` : '—';
      return `${p}% • ${tt}s (${avgStr}/q)`;
    }
    if (key === 'symbols' || key === 'matrices') {
      return `score ${local?.score ?? '—'} • ${local?.time_ms ?? local?.time ?? '—'} ms`;
    }
    return `${local?.percent ?? '—'}%`;
  } catch {
    return '—';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  iconBtn: { padding: 6 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },

  // Perfil
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffd166',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#d9a93a',
  },
  profileName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  profileMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffd166',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaPillTxt: { color: '#0a0f12', fontSize: 12, fontWeight: '800' },

  // Abas
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: '#00d3aa' },
  tabInactive: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  tabTxt: { fontWeight: '800', fontSize: 14 },
  tabTxtActive: { color: '#0a0f12' },
  tabTxtInactive: { color: '#e6f0ff' },

  // Cards
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#fff', fontWeight: '800', marginLeft: 8, fontSize: 15 },
  cardBadge: { color: '#b2c7d3', fontSize: 12 },

  // Segmentos
  segmentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 2 },
  segmentChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  segmentChipActive: { backgroundColor: '#ffd166', borderColor: '#ffd166' },
  segmentTxt: { color: '#d1e8ff', fontSize: 12, fontWeight: '700' },
  segmentTxtActive: { color: '#0a0f12' },

  // Linhas de ranking
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  pos: { minWidth: 42, paddingRight: 6, color: '#ffd166', fontWeight: '800', textAlign: 'left' },
  name: { color: '#fff', fontWeight: '700' },
  metric: { color: '#b2c7d3', fontSize: 12, marginTop: 2 },

  emptyTxt: { color: '#b2c7d3', marginTop: 6 },
});