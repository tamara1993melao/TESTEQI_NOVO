import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, StyleSheet
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { listarDesafios } from './serviceDesafio';

export default function DesafioHub({ navigation }) {
  const [dados,setDados] = useState([]);
  const [loading,setLoading] = useState(false);

  const ordenar = useCallback(list =>
    list.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
  ,[]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const lst = await listarDesafios(100);
    setDados(ordenar(lst));
    setLoading(false);
  },[ordenar]);

  useEffect(()=>{ carregar(); },[carregar]);

  function renderItem({ item }) {
    const encerrado = new Date(item.deadline) < new Date() || !item.active;
    return (
      <TouchableOpacity
        onPress={()=> navigation.navigate('DesafioDetalhe', { id:item.id })}
        activeOpacity={0.85}
        style={styles.card}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, encerrado ? styles.badgeRed : styles.badgeGreen]}>
              <Text style={styles.badgeTxt}>{encerrado ? 'ENCERRADO' : 'ATIVO'}</Text>
            </View>
            <Text style={styles.deadlineTxt}>
              Prazo {new Date(item.deadline).toLocaleDateString()}
            </Text>
          </View>
          <Feather
            name="chevron-right"
            size={20}
            color="#9ad8ff"
            style={{ marginLeft: 8 }}
          />
        </View>
        <Text style={styles.question} numberOfLines={3}>{item.question}</Text>
      </TouchableOpacity>
    );
  }

  const vazio = !loading && dados.length === 0;

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#0f2027' }} edges={['top','bottom']}>
      <LinearGradient
        colors={['#0f2027','#203a43','#2c5364']}
        style={{ flex:1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={()=> navigation.goBack()} style={styles.headerBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>Desafios</Text>
          <View style={{ width:32 }} />
        </View>

        {vazio && (
          <View style={styles.emptyWrap}>
            <Feather name="inbox" size={40} color="#9ad8ff55" />
            <Text style={styles.emptyTitle}>Nenhum desafio ativo</Text>
            <Text style={styles.emptySub}>
              Assim que um novo desafio for lançado ele aparecerá aqui.
            </Text>
            <TouchableOpacity
              onPress={carregar}
              style={styles.reloadBtn}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={16} color="#0f2027" />
              <Text style={styles.reloadTxt}>Atualizar</Text>
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          data={dados}
            keyExtractor={i=>i.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={carregar} tintColor="#fff" />
          }
          contentContainerStyle={{ padding:16, paddingBottom:40 }}
        />
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:{
    flexDirection:'row',
    alignItems:'center',
    paddingHorizontal:14,
    paddingTop:8,
    paddingBottom:10
  },
  headerBtn:{ padding:6 },
  headerTitle:{ flex:1, color:'#fff', fontSize:22, fontWeight:'800', textAlign:'center' },

  card:{
    backgroundColor:'rgba(255,255,255,0.05)',
    borderRadius:18,
    padding:18,
    marginBottom:14,
    borderWidth:1,
    borderColor:'rgba(255,255,255,0.08)'
  },
  cardHeader:{
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
    marginBottom:10
  },
  badgeRow:{ flexDirection:'row', alignItems:'center' },
  badge:{
    paddingHorizontal:10,
    paddingVertical:4,
    borderRadius:8,
    marginRight:10
  },
  badgeGreen:{ backgroundColor:'#214d39' },
  badgeRed:{ backgroundColor:'#5a2b2b' },
  badgeTxt:{ color:'#fff', fontSize:11, fontWeight:'700', letterSpacing:1 },
  deadlineTxt:{ color:'#9ad8ff', fontSize:12, fontWeight:'600' },
  question:{ color:'#fff', fontSize:16, fontWeight:'700', lineHeight:22 },

  emptyWrap:{
    alignItems:'center',
    marginTop:60,
    paddingHorizontal:32
  },
  emptyTitle:{ color:'#fff', fontSize:18, fontWeight:'700', marginTop:18 },
  emptySub:{ color:'#d1e8ff', marginTop:8, textAlign:'center', lineHeight:20 },
  reloadBtn:{
    marginTop:22,
    flexDirection:'row',
    alignItems:'center',
    gap:6,
    backgroundColor:'#9ad8ff',
    paddingHorizontal:16,
    paddingVertical:10,
    borderRadius:12
  },
  reloadTxt:{ color:'#0f2027', fontSize:14, fontWeight:'600' }
});