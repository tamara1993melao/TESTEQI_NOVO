import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';

export default function NoticiasHub({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const fetchArticles = async () => {
    try {
      setErrorMsg(null);
      const { data, error } = await supabase
        .from('articles')
        .select('id,title,subtitle,cover_url,published_at,is_pinned,author_name')
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      setErrorMsg(e?.message || 'Falha ao carregar notícias.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchArticles();
    const channel = supabase
      .channel('rt-articles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, fetchArticles)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('NoticiaDetalhe', { id: item.id })}
      activeOpacity={0.9}
    >
      <View style={styles.coverWrap}>
        {item.cover_url ? (
          <Image source={{ uri: item.cover_url }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Feather name="image" size={28} color="#9bb6c6" />
          </View>
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
          style={styles.coverOverlay}
        />
        <View style={styles.topRow}>
          {item.is_pinned ? (
            <View style={styles.badge}>
              <Feather name="bookmark" size={12} color="#0a0f12" />
              <Text style={styles.badgeTxt}>Fixado</Text>
            </View>
          ) : <View />}
        </View>
        <View style={styles.titleOver}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.meta}>
            {(item.author_name || '').trim() || '—'} • {new Date(item.published_at).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {item.subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{item.subtitle}</Text> : null}
    </TouchableOpacity>
  );

  const Empty = () => (
    <View style={styles.empty}>
      <Feather name="rss" size={26} color="#9ad8ff" />
      <Text style={styles.emptyTitle}>{errorMsg ? 'Não foi possível carregar' : 'Sem notícias ainda'}</Text>
      <Text style={styles.emptySub}>
        {errorMsg ? 'Verifique sua conexão e tente novamente.' : 'Quando houver conteúdos, eles aparecerão aqui.'}
      </Text>
      <TouchableOpacity style={styles.tryAgainBtn} onPress={fetchArticles} activeOpacity={0.9}>
        <Feather name="refresh-ccw" color="#0a0f12" size={14} />
        <Text style={styles.tryAgainTxt}>Tentar novamente</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notícias</Text>
        <TouchableOpacity onPress={fetchArticles} style={{ padding: 6 }}>
          <Feather name="refresh-ccw" size={18} color="#b2c7d3" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
          ListEmptyComponent={<Empty />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchArticles(); }}
              tintColor="#fff"
              colors={['#ffffff']}
              progressBackgroundColor="#203a43"
            />
          }
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },

  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    // sutil profundidade
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  coverWrap: { width: '100%', height: 180, position: 'relative', backgroundColor: '#00000033' },
  cover: { width: '100%', height: '100%' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  topRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffd166', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeTxt: { color: '#0a0f12', fontWeight: '800', fontSize: 11 },
  titleOver: { position: 'absolute', left: 12, right: 12, bottom: 10 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  subtitle: { color: '#cfe5f0', paddingHorizontal: 12, paddingVertical: 10 },
  meta: { color: '#9ad8ff', fontSize: 12, marginTop: 6 },

  empty: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 8 },
  emptySub: { color: '#cfe5f0', fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  tryAgainBtn: { marginTop: 12, backgroundColor: '#00d3aa', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tryAgainTxt: { color: '#0a0f12', fontWeight: '800' },
});