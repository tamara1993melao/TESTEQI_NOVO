import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';

function toIsoDate(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((br || '').trim());
  if (!m) return null;
  const dd = +m[1], mm = +m[2], yyyy = +m[3];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
function fromIsoDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}
function maskBirth(t) {
  const d = (t || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0,2)}/${d.slice(2)}`;
  return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`;
}
function mmss(totalSec) {
  if (totalSec == null) return '—';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
const FRASES = [
  'Você está no caminho certo. Consistência vence intensidade.',
  'Cada treino deixa seu desenho intelectual mais nítido.',
  'Aprender um pouco todo dia cria saltos no entendimento.',
  'Foque no progresso, não na perfeição.',
  'Sua curiosidade é o motor do seu crescimento.',
];

export default function Perfil({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [birth, setBirth] = useState(''); // dd/mm/aaaa

  // STF: melhor resultado do usuário (se existir)
  const [myBestStf, setMyBestStf] = useState(null);
  const [fetchingStf, setFetchingStf] = useState(false);

  // Em quais jogos o usuário está no Top 10 global
  const [top10Games, setTop10Games] = useState([]); // [{key,title,pos}]

  // Estatísticas de Desafios
  const [challengeStats, setChallengeStats] = useState(null);
  const [loadingChallenges, setLoadingChallenges] = useState(false);

  const [tfSummary, setTfSummary] = useState(null);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        if (mounted) setLoading(false);
        return;
      }
      const u = data.user;
      if (!mounted) return;

      setEmail(u.email || '');
      const meta = u.user_metadata || {};
      const { data: p } = await supabase
        .from('profiles')
        .select('name, nickname, birth_date')
        .eq('id', u.id)
        .maybeSingle();
      const nm = p?.name || meta.full_name || meta.name || '';
      const nn = p?.nickname || meta.nickname || '';
      const bd = p?.birth_date || meta.birth_date || null;
      setName(nm);
      setNickname(nn);
      setBirth(fromIsoDate(bd));
      setLoading(false);

      await Promise.all([
        loadStfData(u.id, u.email),
        loadTop10Placements(u.id),
        loadChallengeStats(u.id),
        loadTfSummary(u.id) // <--- ADICIONADO
      ]);
    };

    bootstrap();

    const unsub = navigation.addListener?.('focus', async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (u) {
        await Promise.all([
          loadStfData(u.id, u.email),
          loadTop10Placements(u.id),
          loadChallengeStats(u.id),
          loadTfSummary(u.id) // <--- ADICIONADO
        ]);
      }
    });

    return () => { mounted = false; unsub?.(); };
  }, [navigation]);

  async function loadStfData(userId, userEmail) {
    setFetchingStf(true);
    try {
      if (!userId && !userEmail) { setMyBestStf(null); return; }

      // 1) por user_id (principal)
      let best = null;
      let { data, error } = await supabase
        .from('stf_results')
        .select('qi,correct_count,time_used,created_at')
        .eq('user_id', userId)
        .order('qi', { ascending: false })
        .order('time_used', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error) best = data;

      // 2) fallback por e-mail (para resultados antigos sem user_id)
      if (!best && userEmail) {
        const res = await supabase
          .from('stf_results')
          .select('qi,correct_count,time_used,created_at')
          .eq('email', userEmail)
          .order('qi', { ascending: false })
          .order('time_used', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        best = res.data || null;
      }

      setMyBestStf(best || null);
    } catch {
      setMyBestStf(null);
    } finally {
      setFetchingStf(false);
    }
  }

  // Adicione (ou substitua) a função que carrega os Top 10
  async function loadTop10Placements(userId) {
    setTop10Games([]);
    const boards = [
      { key:'thinkfast', title:'ThinkFast', view:'thinkfast_leaderboard', hasPos:true, select:'pos,user_id' },
      { key:'thinkfast90', title:'ThinkFast 90s', view:'thinkfast90_results', hasPos:false,
        orders:[
          { col:'percent', asc:false },
          { col:'avg_ms', asc:true },
          { col:'best_single_ms', asc:true },
          { col:'created_at', asc:true },
        ],
        select:'user_id,percent,avg_ms,best_single_ms,created_at'
      },
      // SEQUENCES (segmentado por level)
      { key:'sequences', title:'Sequências', view:'sequences_results_best', hasPos:false,
        segmentField:'level',
        segments:['facil','medio','dificil'],
        orders:[
          { col:'percent', asc:false },
          { col:'time_total_s', asc:true },
          { col:'avg_time_s', asc:true },
          { col:'created_at', asc:true }
        ],
        select:'user_id,level,percent,time_total_s,avg_time_s,created_at'
      },
      // PROCURAR SÍMBOLOS (segmentado por level)
      { key:'procurar', title:'Procurar Símbolos', view:'procurar_simbolos_results_best', hasPos:false,
        segmentField:'level',
        segments:['facil','medio','dificil'],
        orders:[
          { col:'percent', asc:false },
          { col:'time_total_s', asc:true },
          { col:'avg_time_s', asc:true },
          { col:'created_at', asc:true }
        ],
        select:'user_id,level,percent,time_total_s,avg_time_s,score,created_at'
      },
      { key:'matrices', title:'Matrizes', view:'matrices_leaderboard', hasPos:true, select:'pos,user_id' },
      { key:'adivinhe', title:'Personalidades • Adivinhe', view:'personalities_adivinhe_leaderboard', hasPos:true, select:'pos,user_id' },
      { key:'iq', title:'Personalidades • IQ', view:'personalities_iq_leaderboard', hasPos:true, select:'pos,user_id' },
      { key:'connections', title:'Personalidades • Conexões', view:'personalities_connections_leaderboard', hasPos:true, select:'pos,user_id' },
    ];

    const results = [];

    const segLabel = (seg) => {
      if (!seg) return '';
      switch(seg) {
        case 'facil': return 'Fácil';
        case 'medio': return 'Médio';
        case 'dificil': return 'Difícil';
        default: return seg;
      }
    };

    for (const b of boards) {
      if (b.hasPos) {
        // View já tem pos
        const { data, error } = await supabase
          .from(b.view)
          .select(b.select)
          .eq('user_id', userId)
          .lte('pos', 10)
          .maybeSingle();
        if (!error && data?.pos) {
          results.push({
            key: b.key,
              title: b.title,
            pos: data.pos
          });
        }
      } else {
        // Sem pos: calcular no cliente
        if (b.segmentField && b.segments?.length) {
          for (const seg of b.segments) {
            let q = supabase.from(b.view).select(b.select).eq(b.segmentField, seg);
            b.orders.forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
            q = q.limit(50); // pega top 50 daquele segmento
            const { data, error } = await q;
            if (error || !data?.length) continue;
            const idx = data.findIndex(r => r.user_id === userId);
            if (idx !== -1 && idx < 10) {
              results.push({
                key: `${b.key}_${seg}`,
                title: `${b.title} (${segLabel(seg)})`,
                pos: idx + 1
              });
            }
          }
        } else {
          let q = supabase.from(b.view).select(b.select);
          b.orders.forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
          q = q.limit(50);
          const { data, error } = await q;
          if (error || !data?.length) continue;
          const idx = data.findIndex(r => r.user_id === userId);
          if (idx !== -1 && idx < 10) {
            results.push({
              key: b.key,
              title: b.title,
              pos: idx + 1
            });
          }
        }
      }
    }

    // Ordena por posição e seta estado
    setTop10Games(results.sort((a,b)=>a.pos - b.pos));
  }

  async function loadChallengeStats(userId) {
    if (!userId) { setChallengeStats(null); return; }
    setLoadingChallenges(true);
    try {
      const { data, error } = await supabase
        .from('challenge_submissions')
        .select('challenge_id,is_correct')
        .eq('user_id', userId);

      if (error) { setChallengeStats(null); return; }

      const totalSubs = data.length;
      const tentadosSet = new Set();
      const concluidosSet = new Set();
      const attemptsByChallenge = {};
      data.forEach(s => {
        tentadosSet.add(s.challenge_id);
        attemptsByChallenge[s.challenge_id] = (attemptsByChallenge[s.challenge_id]||0)+1;
        if (s.is_correct) concluidosSet.add(s.challenge_id);
      });
      const tentados = tentadosSet.size;
      const concluidos = concluidosSet.size;
      const pct = tentados ? (concluidos / tentados) * 100 : 0;
      let somaTentativasConcluidos = 0;
      concluidosSet.forEach(id => { somaTentativasConcluidos += attemptsByChallenge[id]||0; });
      const mediaTentativas = concluidos ? (somaTentativasConcluidos / concluidos) : 0;

      setChallengeStats({
        tentados,
        concluidos,
        totalSubs,
        pct,
        mediaTentativas
      });
    } catch {
      setChallengeStats(null);
    } finally {
      setLoadingChallenges(false);
    }
  }

  async function loadTfSummary(userId) {
    try {
      if (!userId) { setTfSummary(null); return; }
      // Medalhas e dias (usar view)
      const { data: rows } = await supabase
        .from('thinkfast_daily_leaderboard')
        .select('day,rank')
        .eq('user_id', userId);
      let gold=0,silver=0,bronze=0;
      const daysPlayed = new Set();
      (rows||[]).forEach(r=>{
        daysPlayed.add(r.day);
        if (r.rank===1) gold++;
        else if (r.rank===2) silver++;
        else if (r.rank===3) bronze++;
      });
      // Tentativas totais
      const { count: attempts } = await supabase
        .from('thinkfast_daily_attempts')
        .select('id',{ count:'exact', head:true })
        .eq('user_id', userId);
      setTfSummary({
        days: daysPlayed.size,
        attempts: attempts ?? 0,
        medals:{ gold, silver, bronze }
      });
    } catch {
      setTfSummary(null);
    }
  }

  async function handleSave() {
    const birthIso = birth ? toIsoDate(birth) : null;
    if (birth && !birthIso) return Alert.alert('Atenção', 'Data inválida. Use dd/mm/aaaa.');
    setSaving(true);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      setSaving(false);
      return Alert.alert('Sessão', 'Faça login novamente.');
    }
    const u = userData.user;

    const { error: authErr } = await supabase.auth.updateUser({
      data: {
        full_name: name || null,
        nickname: nickname || null,
        birth_date: birthIso || null,
      },
    });
    if (authErr) {
      setSaving(false);
      return Alert.alert('Erro', authErr.message);
    }

    const { error: upErr } = await supabase.from('profiles').upsert({
      id: u.id,
      email: u.email,
      name: name || null,
      nickname: nickname || null,
      birth_date: birthIso || null,
    });
    if (upErr) console.log('[profiles] upsert error:', upErr);

    setSaving(false);
    Alert.alert('Pronto', 'Perfil atualizado.');
    navigation.goBack();
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      Alert.alert('Erro ao sair', e?.message || String(e));
    }
  }

  if (loading) {
    return (
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </LinearGradient>
    );
  }

  const base = (nickname || name || email || '').trim();
  const parts = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] || 'U') + (parts[1]?.[0] || '')).toUpperCase();
  const frase = FRASES[new Date().getDate() % FRASES.length];

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Feather name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Seu perfil</Text>
            <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}>
              <Feather name="log-out" size={18} color="#ffd166" />
            </TouchableOpacity>
          </View>

          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{initials}</Text>
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.displayName} numberOfLines={1}>{nickname || name || (email?.split('@')[0] || 'Você')}</Text>
              <Text style={styles.email} numberOfLines={1}>{email}</Text>
            </View>
          </View>

          {/* Banner motivacional */}
          <View style={styles.banner}>
            <Feather name="trending-up" size={18} color="#0a0f12" />
            <Text style={styles.bannerTxt}>{frase}</Text>
          </View>

          {/* STF: Resultado (se tiver) ou CTA com paywall em Testes */}
          {fetchingStf ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 10 }} />
          ) : myBestStf ? null : (
            <View style={styles.ctaCard}>
              <Text style={styles.ctaTitle}>Descubra seu QI</Text>
              <Text style={styles.ctaSub}>Faça o Teste Oficial e desbloqueie sua pontuação.</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Testes', { startOn: 'STF' })}
                style={styles.ctaBtn}
                activeOpacity={0.9}
              >
                <Feather name="activity" size={18} color="#0a0f12" />
                <Text style={styles.ctaBtnTxt}>Fazer agora</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Seu melhor STF */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Feather name="bar-chart-2" size={16} color="#ffd166" />
                <Text style={styles.cardTitle}>Seu desempenho no STF</Text>
              </View>
            </View>

            {myBestStf ? (
              <View style={styles.statsRow}>
                <Stat icon="cpu" label="QI" value={myBestStf.qi ?? '—'} />
                <Stat icon="check-circle" label="Acertos" value={myBestStf.correct_count ?? '—'} />
                <Stat icon="clock" label="Tempo" value={mmss(myBestStf.time_used)} />
              </View>
            ) : (
              <Text style={styles.emptyTxt}>Sem resultados ainda. Faça o teste para registrar.</Text>
            )}
          </View>

          {/* Em quais jogos você está no Top 10 Global */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Feather name="award" size={16} color="#9ad8ff" />
                <Text style={styles.cardTitle}>Seus Top 10 Globais</Text>
              </View>
            </View>
            {top10Games.length ? (
              <View style={{ marginTop: 8 }}>
                {top10Games.map(g => (
                  <View key={g.key} style={styles.row}>
                    <Text style={styles.pos}>#{g.pos}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{g.title}</Text>
                      <Text style={styles.metric}>Você está no Top 10 global</Text>
                    </View>
                    <Feather name="star" size={16} color="#ffd166" />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyTxt}>Você ainda não está no Top 10 global. Continue treinando!</Text>
            )}
          </View>

          {/* Estatísticas de Desafios */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection:'row', alignItems:'center' }}>
                <Feather name="flag" size={16} color="#ff8fa3" />
                <Text style={styles.cardTitle}>Desafios</Text>
              </View>
              {challengeStats && (
                <Text style={styles.cardBadge}>
                  {challengeStats.concluidos}/{challengeStats.tentados} concluídos
                </Text>
              )}
            </View>

            {loadingChallenges && (
              <ActivityIndicator color="#fff" style={{ marginTop:10 }} />
            )}

            {!loadingChallenges && !challengeStats && (
              <Text style={styles.emptyTxt}>Nenhuma tentativa registrada ainda.</Text>
            )}

            {!loadingChallenges && challengeStats && challengeStats.tentados === 0 && (
              <Text style={styles.emptyTxt}>
                Você ainda não tentou nenhum desafio. Participe do primeiro para ver seu progresso!
              </Text>
            )}

            {!loadingChallenges && challengeStats && challengeStats.tentados > 0 && (
              <>
                <View style={styles.progressWrap}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.min(100, challengeStats.pct).toFixed(1)}%` }
                      ]}
                    />
                  </View>
                  <Text style={styles.progressLabel}>
                    Sucesso: {challengeStats.pct.toFixed(0)}%
                  </Text>
                </View>

                <View style={styles.challengeStatsRow}>
                  <ChallengeStat
                    icon="target"
                    label="Tentados"
                    value={challengeStats.tentados}
                  />
                  <ChallengeStat
                    icon="check"
                    label="Concluídos"
                    value={challengeStats.concluidos}
                  />
                  <ChallengeStat
                    icon="layers"
                    label="Submissões"
                    value={challengeStats.totalSubs}
                  />
                  <ChallengeStat
                    icon="repeat"
                    label="Média tent."
                    value={challengeStats.mediaTentativas.toFixed(1)}
                  />
                </View>
                <Text style={styles.tipTxt}>
                  Complete desafios com menos tentativas para elevar sua taxa de sucesso.
                </Text>
              </>
            )}

            {/* Painel ThinkFast removido daqui - agora é um quadro separado */}
          </View>

          {/* Quadro separado: ThinkFast Desafio Diário */}
          <View style={styles.tfPanelStandalone}>
            <View style={styles.tfPanelHeader}>
              <Feather name="zap" size={16} color="#ffd166" />
              <Text style={styles.tfPanelTitle}>ThinkFast • Desafio Diário</Text>
            </View>

            {!tfSummary && (
              <Text style={styles.tfPanelLoading}>Carregando resumo...</Text>
            )}

            {tfSummary && (
              <>
                <View style={styles.tfStatsRow}>
                  <View style={styles.tfStatBox}>
                    <Text style={styles.tfStatVal}>{tfSummary.days}</Text>
                    <Text style={styles.tfStatKey}>Dias</Text>
                  </View>
                  <View style={styles.tfStatBox}>
                    <Text style={styles.tfStatVal}>{tfSummary.attempts}</Text>
                    <Text style={styles.tfStatKey}>Tentativas</Text>
                  </View>
                  <View style={styles.tfStatBox}>
                    <Text style={styles.tfStatVal}>
                      {tfSummary.medals.gold + tfSummary.medals.silver + tfSummary.medals.bronze}
                    </Text>
                    <Text style={styles.tfStatKey}>Medalhas</Text>
                  </View>
                </View>

                <View style={styles.tfMedalsRow}>
                  <View style={styles.tfMedalItem}>
                    <Text style={[styles.tfMedalEmoji,{ shadowColor:'#ffd166' }]}>🥇</Text>
                    <Text style={styles.tfMedalCount}>{tfSummary.medals.gold}</Text>
                    <Text style={styles.tfMedalLabel}>Ouro</Text>
                  </View>
                  <View style={styles.tfMedalItem}>
                    <Text style={[styles.tfMedalEmoji,{ shadowColor:'#d0d4dc' }]}>🥈</Text>
                    <Text style={styles.tfMedalCount}>{tfSummary.medals.silver}</Text>
                    <Text style={styles.tfMedalLabel}>Prata</Text>
                  </View>
                  <View style={styles.tfMedalItem}>
                    <Text style={[styles.tfMedalEmoji,{ shadowColor:'#d39552' }]}>🥉</Text>
                    <Text style={styles.tfMedalCount}>{tfSummary.medals.bronze}</Text>
                    <Text style={styles.tfMedalLabel}>Bronze</Text>
                  </View>
                </View>

                <Text style={styles.tfPanelHint}>
                  Medalhas são atribuídas aos 3 primeiros ao final de cada dia.
                </Text>
              </>
            )}
          </View>

          {/* Form de perfil */}
          <View style={styles.card}>
            <Text style={styles.label}>Nome completo</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Seu nome"
              placeholderTextColor="#8aa2b1"
              returnKeyType="next"
            />

            <Text style={styles.label}>Apelido (aparece nos recordes)</Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              placeholder="Seu apelido"
              placeholderTextColor="#8aa2b1"
              returnKeyType="next"
            />

            <Text style={styles.label}>Data de nascimento</Text>
            <TextInput
              style={styles.input}
              value={birth}
              onChangeText={(t) => setBirth(maskBirth(t))}
              placeholder="dd/mm/aaaa"
              placeholderTextColor="#8aa2b1"
              keyboardType="numeric"
              maxLength={10}
              returnKeyType="done"
            />

            <TouchableOpacity style={styles.btn} onPress={handleSave} disabled={saving} activeOpacity={0.9}>
              {saving ? <ActivityIndicator color="#0a0f12" /> : (<><Feather name="save" size={18} color="#0a0f12" /><Text style={styles.btnTxt}>Salvar</Text></>)}
            </TouchableOpacity>
          </View>

          <View style={styles.thinkFastCard}>
            {/* ... */}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const Stat = ({ icon, label, value }) => (
  <View style={styles.statBox}>
    <Feather name={icon} size={16} color="#00d3aa" />
    <Text style={styles.statVal}>{value}</Text>
    <Text style={styles.statKey}>{label}</Text>
  </View>
);

const ChallengeStat = ({ icon, label, value }) => (
  <View style={styles.challengeStatBox}>
    <Feather name={icon} size={14} color="#ff8fa3" />
    <Text style={styles.challengeStatVal}>{value}</Text>
    <Text style={styles.challengeStatKey}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { padding: 18 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 50, marginBottom: 14 },
  iconBtn: { padding: 6 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },

  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#ffd166',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#d9a93a',
  },
  avatarTxt: { color: '#0a0f12', fontSize: 20, fontWeight: '900' },
  displayName: { color: '#fff', fontSize: 18, fontWeight: '900' },
  email: { color: '#b2c7d3', marginTop: 2 },

  banner: {
    marginTop: 6,
    backgroundColor: '#00d3aa',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  bannerTxt: { color: '#0a0f12', fontWeight: '800', flex: 1 },

  card: { backgroundColor: 'rgba(8,12,20,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 16, padding: 14, marginTop: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#fff', fontWeight: '800', marginLeft: 8, fontSize: 15 },
  cardBadge: { color: '#b2c7d3', fontSize: 12 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 4, gap: 4 },
  statVal: { color: '#fff', fontSize: 18, fontWeight: '900' },
  statKey: { color: '#b2c7d3', fontSize: 12 },

  // Lista simples
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  pos: { width: 42, color: '#ffd166', fontWeight: '800', textAlign: 'left' },
  name: { color: '#fff', fontWeight: '700' },
  metric: { color: '#b2c7d3', fontSize: 12, marginTop: 2 },

  // Form
  label: { color: '#b2c7d3', fontSize: 13, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: '#ffffff12', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#fff' },
  btn: { backgroundColor: '#ffd166', borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
  btnTxt: { color: '#0a0f12', fontSize: 16, fontWeight: '800', marginLeft: 8 },

  emptyTxt: { color: '#b2c7d3', marginTop: 6 },

  // CTA
  ctaCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  ctaTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  ctaSub: { color: '#cfe5f0', marginTop: 4, marginBottom: 10 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffd166', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, alignSelf: 'flex-start' },
  ctaBtnTxt: { color: '#0a0f12', fontWeight: '800' },

  // Estatísticas de Desafios
  progressWrap:{ marginTop:14, marginBottom:6 },
  progressBar:{
    height:10,
    borderRadius:8,
    backgroundColor:'rgba(255,255,255,0.08)',
    overflow:'hidden'
  },
  progressFill:{
    height:'100%',
    backgroundColor:'#ff8fa3',
    borderRadius:8
  },
  progressLabel:{ color:'#ff8fa3', fontSize:12, fontWeight:'700', marginTop:6, letterSpacing:0.5 },

  challengeStatsRow:{
    flexDirection:'row',
    flexWrap:'wrap',
    marginTop:12,
    justifyContent:'space-between'
  },
  challengeStatBox:{
    width:'23.5%',
    backgroundColor:'rgba(255,255,255,0.06)',
    borderRadius:10,
    paddingVertical:8,
    alignItems:'center',
    marginBottom:8,
    borderWidth:1,
    borderColor:'rgba(255,255,255,0.08)'
  },
  challengeStatVal:{ color:'#fff', fontSize:15, fontWeight:'800', marginTop:2 },
  challengeStatKey:{ color:'#b2c7d3', fontSize:10, marginTop:2, textAlign:'center' },
  tipTxt:{ color:'#b2c7d3', fontSize:11, marginTop:10, lineHeight:16 },

  // Modal ThinkFast
  tfPanel:{
    marginTop:18,
    backgroundColor:'rgba(255, 255, 255, 0.05)',
    borderRadius:18,
    padding:14,
    borderWidth:1,
    borderColor:'rgba(255,255,255,0.50)'
  },
  tfPanelStandalone:{
    marginTop:12,
    backgroundColor:'rgba(2, 2, 2, 0.5)',
    borderRadius:18,
    padding:14,
    borderWidth:1,
    borderColor:'rgba(255,255,255,0.08)'
  },
  tfPanelHeader:{
    flexDirection:'row',
    alignItems:'center',
    gap:8,
    marginBottom:10
  },
  tfPanelTitle:{
    color:'#fff',
    fontSize:14,
    fontWeight:'800',
    letterSpacing:0.5
  },
  tfPanelLoading:{ color:'#b2c7d3', fontSize:12 },
  tfStatsRow:{
    flexDirection:'row',
    justifyContent:'space-between',
    marginBottom:12
  },
  tfStatBox:{
    flex:1,
    marginHorizontal:4,
    backgroundColor:'rgba(255,255,255,0.06)',
    paddingVertical:10,
    borderRadius:12,
    alignItems:'center'
  },
  tfStatVal:{ color:'#ffd166', fontSize:18, fontWeight:'900' },
  tfStatKey:{ color:'#b2c7d3', fontSize:11, marginTop:2, fontWeight:'600' },
  tfMedalsRow:{
    flexDirection:'row',
    justifyContent:'space-around',
    marginBottom:10
  },
  tfMedalItem:{
    alignItems:'center',
    flex:1
  },
  tfMedalEmoji:{
    fontSize:30,
    textAlign:'center'
  },
  tfMedalCount:{
    color:'#fff',
    fontSize:16,
    fontWeight:'800',
    marginTop:4
  },
  tfMedalLabel:{
    color:'#b2c7d3',
    fontSize:11,
    marginTop:2,
    fontWeight:'600'
  },
  tfPanelHint:{
    color:'#9bb4c0',
    fontSize:11,
    lineHeight:16,
    textAlign:'center',
    marginTop:4
  },
});