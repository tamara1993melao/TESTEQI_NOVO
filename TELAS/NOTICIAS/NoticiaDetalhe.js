import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../../planoContext';
import { tentarUsar } from '../../core/gatingLocal';
import { usePaywall } from '../../paywallContext';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'; // +
 
// Defina no escopo do módulo (visível para o StyleSheet)
const COMPOSER_HEIGHT = 56;

// Nome do Perfil (igual Perfil.js)
async function fetchDisplayName() {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return null;
    const meta = u.user_metadata || {};
    const { data: p } = await supabase
      .from('profiles')
      .select('nickname,name')
      .eq('id', u.id)
      .maybeSingle();
    return p?.nickname || p?.name || meta.nickname || meta.full_name || meta.name || (u.email ? u.email.split('@')[0] : null);
  } catch {
    return null;
  }
}

export default function NoticiaDetalhe({ route, navigation }) {
  const { id } = route.params;
  const [art, setArt] = useState(null);
  const [comments, setComments] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  // removido authorName manual
  const [textHeight, setTextHeight] = useState(44);
  const [likesCount, setLikesCount] = useState({});
  const [likedByMe, setLikedByMe] = useState(new Set());
  const [userId, setUserId] = useState(null);
  const [displayName, setDisplayName] = useState(null);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);

  // >>> GATING hooks
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();

  // Gradiente mais suave no Android (não altera iOS)
  const GRADIENT_COLORS = Platform.select({
    android: ['#0f2027', '#183344', '#2a4d5c', '#2c5364'],
    ios: ['#0f2027', '#203a43', '#2c5364'],
    default: ['#0f2027', '#203a43', '#2c5364'],
  });
  const GRADIENT_LOCATIONS = Platform.OS === 'android' ? [0, 0.4, 0.75, 1] : undefined;

  const load = async () => {
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from('articles').select('*').eq('id', id).maybeSingle(),
      supabase.from('article_comments').select('id,content,created_at,user_id,author_name').eq('article_id', id).order('created_at', { ascending: true })
    ]);
    setArt(a || null);
    await hydrateLikes(c || []);
    setComments(c || []);
  };

  const hydrateLikes = async (list) => {
    try {
      const ids = (list || []).map(x => x.id);
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id || null;
      setUserId(uid);
      if (!ids.length) { setLikesCount({}); setLikedByMe(new Set()); return; }
      const { data: likes } = await supabase
        .from('article_comment_likes')
        .select('comment_id,user_id')
        .in('comment_id', ids);
      const counts = {};
      const mine = new Set();
      (likes || []).forEach(l => {
        counts[l.comment_id] = (counts[l.comment_id] || 0) + 1;
        if (uid && l.user_id === uid) mine.add(l.comment_id);
      });
      setLikesCount(counts);
      setLikedByMe(mine);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      const dn = await fetchDisplayName();
      setDisplayName(dn);
      await load();
    })();
    const subComments = supabase
      .channel('rt-article-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'article_comments', filter: `article_id=eq.${id}` }, load)
      .subscribe();
    const subLikes = supabase
      .channel('rt-article-comment-likes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'article_comment_likes' }, () => hydrateLikes(comments))
      .subscribe();
    return () => { supabase.removeChannel(subComments); supabase.removeChannel(subLikes); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendComment = async () => {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    // >>> GATING: verifica limite NOTICIA_COMENT antes de enviar
    try {
      const r = await tentarUsar('NOTICIA_COMENT', plano);
      console.log('[NOTICIA][gating] NOTICIA_COMENT resultado', r);
      if (!r.ok) {
        if (r.erro === 'nao_logado') {
          setSending(false);
          Alert.alert('Login necessário', 'Entre na sua conta para comentar.');
          navigation.navigate && navigation.navigate('Login');
          return;
        }
        if (r.erro === 'limite') {
          setSending(false);
            openPaywall();
          return;
        }
        if (r.erro === 'compra_unica_necessaria') {
          setSending(false);
          openPaywall('NOTICIA_COMENT');
          return;
        }
        if (r.erro === 'codigo_desconhecido') {
          // fallback: permite comentar mesmo sem definição do código
        } else {
          setSending(false);
          return; // outros erros silenciam
        }
      }
    } catch (e) {
      console.log('[NOTICIA][gating] erro inesperado', e);
      // Falha de gating: continua para não bloquear experiência
    }
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
      setSending(false);
      return Alert.alert('Login necessário', 'Entre na sua conta para comentar.');
    }
    const payload = {
      article_id: id,
      user_id: data.user.id,
      content,
      author_name: displayName || null,
    };
    const { error } = await supabase.from('article_comments').insert(payload);
    if (error) Alert.alert('Erro', error.message);
    setText('');
    setSending(false);
  };

  const toggleLike = async (commentId) => {
    if (!userId) return Alert.alert('Login necessário', 'Entre na sua conta para curtir comentários.');
    const liked = likedByMe.has(commentId);
    // otimista
    setLikedByMe(prev => {
      const s = new Set(prev);
      if (liked) s.delete(commentId); else s.add(commentId);
      return s;
    });
    setLikesCount(prev => ({ ...prev, [commentId]: Math.max(0, (prev[commentId] || 0) + (liked ? -1 : 1)) }));
    if (liked) {
      await supabase.from('article_comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
    } else {
      await supabase.from('article_comment_likes').insert({ comment_id: commentId, user_id: userId });
    }
  };

  if (!art) {
    return (
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </LinearGradient>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f2027' }} edges={['top','bottom','left','right']}>
      <LinearGradient colors={GRADIENT_COLORS} locations={GRADIENT_LOCATIONS} start={{x:0,y:0}} end={{x:1,y:1}} style={{ flex: 1 }}>
       {/* Sem margens extras; SafeArea cuida do topo */}
       <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{art?.title || 'Notícia'}</Text>
          <View style={{ width: 28 }} />
        </View>

       {/* iOS: padding garante que o teclado não cubra o composer; Android: height */}
       <KeyboardAvoidingView
         style={{ flex: 1 }}
         behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
         keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : 0} // iOS: evita teclado por cima do composer
       >
         <ScrollView
           ref={scrollRef}
           contentContainerStyle={[
             styles.container,
             { paddingBottom: 24 + Math.max(insets.bottom, 8) } // espaço final para rolar até o composer
           ]}
           keyboardShouldPersistTaps="handled"
         >
           <View style={styles.centerWrap}>
             <View style={styles.bodyCard}>
               {art?.cover_url ? <Image source={{ uri: art.cover_url }} style={styles.cover} /> : null}
               {art?.subtitle ? <Text style={styles.subtitle}>{art.subtitle}</Text> : null}

               {/* byline com autor textual do artigo */}
               <View style={styles.bylineRow}>
                 <View style={styles.bylineAvatar}>
                   <Text style={styles.bylineInitials}>
                     {(art?.author_name || 'Autor').trim().charAt(0).toUpperCase()}
                   </Text>
                 </View>
                 <View style={{ flex: 1 }}>
                   <Text style={styles.bylineName}>{art?.author_name || 'Autor'}</Text>
                   <Text style={styles.bylineMeta}>{new Date(art?.published_at || art?.created_at).toLocaleString()}</Text>
                 </View>
               </View>

               {Array.isArray(art?.content_blocks) && art.content_blocks.length
                 ? renderBlocks(art.content_blocks)
                 : (art?.content ? <Text style={styles.content}>{art.content}</Text> : null)
               }

               {/* Divisor elegante para comentários */}
               <View style={styles.sectionHeader}>
                 <View style={styles.hr} />
                 <Text style={styles.sectionTitle}>Comentários</Text>
                 <View style={styles.hr} />
               </View>

               {comments.length ? comments.map((c) => (
                 <View key={c.id} style={styles.comment}>
                   <View style={styles.avatar}>
                     <Text style={styles.avatarTxt}>{(c.author_name || 'A').trim().charAt(0).toUpperCase()}</Text>
                   </View>
                   <View style={{ flex: 1 }}>
                     <View style={styles.commentHeader}>
                       <Text style={styles.commentAuthor}>{c.author_name || 'Anônimo'}</Text>
                       <Text style={styles.commentMeta}>{new Date(c.created_at).toLocaleString()}</Text>
                     </View>
                     <Text style={styles.commentTxt}>{c.content}</Text>
                     <View style={styles.commentActions}>
                       <TouchableOpacity style={styles.likeBtn} onPress={() => toggleLike(c.id)}>
                         <Feather
                           name="heart"
                           size={14}
                           color={likedByMe.has(c.id) ? '#ff6b6b' : '#b2c7d3'}
                         />
                         <Text style={[styles.likeTxt, likedByMe.has(c.id) && { color: '#ff6b6b', fontWeight: '800' }]}>
                           {likesCount[c.id] || 0}
                         </Text>
                       </TouchableOpacity>
                     </View>
                   </View>
                 </View>
               )) : <Text style={styles.empty}>Seja o primeiro a comentar.</Text>}
             </View>
           </View>

          {/* Campo de comentários no fim da página (dentro do ScrollView) */}
          <View style={[styles.inputBar, { marginTop: 16, paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={styles.composerRow}>
              <TextInput
                style={[styles.input, { height: Math.min(120, Math.max(44, textHeight)) }]}
                value={text}
                onChangeText={setText}
                placeholder="Escreva um comentário..."
                placeholderTextColor="#8aa2b1"
                multiline
                onContentSizeChange={(e) => setTextHeight(e.nativeEvent.contentSize.height)}
                allowFontScaling={false}
                maxFontSizeMultiplier={1.1}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={sendComment} disabled={sending || !text.trim()}>
                {sending ? <ActivityIndicator color="#0a0f12" /> : <Feather name="send" size={18} color="#0a0f12" />}
              </TouchableOpacity>
            </View>
          </View>
         </ScrollView>
       </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // iOS mantém 50; Android usa 8 (aplicado no componente)
  header: { paddingHorizontal: 14, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '900', flex: 1, marginHorizontal: 8 },

  // Mais respiro nas bordas do Scroll
  container: { paddingVertical: 16 },
  // Centraliza e limita a largura de leitura (efeito “coluna”)
  centerWrap: { paddingHorizontal: 16 },
  bodyCard: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 16,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    // Android: evite “retângulo” duro da elevação
    ...Platform.select({ android: { elevation: 0 } }),
  },

  cover: { width: '100%', height: 220, borderRadius: 12, marginBottom: 14, backgroundColor: '#00000033' },
  subtitle: { color: '#cfe5f0', fontSize: 16, marginBottom: 6 },

  // byline (autor do texto)
  bylineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  bylineAvatarImg: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#00000033' },
  bylineAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#203a43', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff22' },
  bylineInitials: { color: '#9ad8ff', fontWeight: '800', fontSize: 13 },
  bylineName: { color: '#e7f6ff', fontWeight: '800' },
  bylineMeta: { color: '#9ad8ff', fontSize: 12 },

  // opcional manter styles.date se usado em outro lugar
  date: { color: '#9ad8ff', fontSize: 12, marginBottom: 12 },

  // Tipografia mais confortável
  content: { color: '#fff', fontSize: 17, lineHeight: 26, textAlign: 'justify', letterSpacing: 0.2, marginBottom: 14 },

  // Divisor de seção clássico
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 12 },
  hr: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.14)' },
  sectionTitle: { color: '#e7f6ff', fontWeight: '900', fontSize: 14, marginHorizontal: 10, textTransform: 'uppercase', letterSpacing: 1 },

  // Comentários com melhor espaçamento
  comment: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#203a43', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff22' },
  avatarTxt: { color: '#9ad8ff', fontWeight: '800', fontSize: 12 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentAuthor: { color: '#e7f6ff', fontWeight: '800' },
  commentTxt: { color: '#e7f6ff', marginTop: 6, lineHeight: 20, textAlign: 'left' },
  commentMeta: { color: '#b2c7d3', fontSize: 11, marginLeft: 8 },
  commentActions: { marginTop: 8, flexDirection: 'row' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999 },
  likeTxt: { color: '#b2c7d3', fontSize: 12 },

  // Barra de composer com mais respiro
  // Remove a “borda” e o fundo chapado para não aparecer a linha sobre comentários
  inputBar: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 0, backgroundColor: 'transparent', minHeight: COMPOSER_HEIGHT },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, backgroundColor: '#ffffff12', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#fff' },
  sendBtn: { backgroundColor: '#ffd166', padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  empty: { color: '#b2c7d3', textAlign: 'center', marginTop: 6 },
});

// Evita textos “gigantes” só no Android (respeita iOS)
if (Platform.OS === 'android') {
  Text.defaultProps = Text.defaultProps || {};
  Text.defaultProps.maxFontSizeMultiplier = 1.1; // trava aumento excessivo
}