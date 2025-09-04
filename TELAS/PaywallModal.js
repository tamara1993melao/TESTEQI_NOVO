import React, { useRef, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Modal
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { usePaywall } from '../paywallContext'
import { usePlano } from '../planoContext'

export default function PaywallModal() {
  const { visible, foco, close } = usePaywall()
  const { plano, setPlano } = usePlano()
  const isPremium = plano !== 'free'
  const fade = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.9)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, speed: 16, bounciness: 6, useNativeDriver: true })
      ]).start()
    } else {
      fade.setValue(0)
      scale.setValue(0.9)
    }
  }, [visible])

  if (!visible) return null

  const handleUpgrade = tipo => {
    setPlano(tipo) // 'premium_mensal' ou 'premium_anual'
    close()
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      <View style={styles.cardWrap}>
        <LinearGradient colors={['#203a43','#2c5364','#0f2027']} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.card}>
          <View style={styles.headerRow}>
            <Feather name="zap" size={20} color="#ffd86b" />
            <Text style={styles.title}>Libere mais partidas</Text>
          </View>

            <Text style={styles.subtitle}>
              {isPremium ? 'Você já está no plano Premium.' :
                'Atingiu o limite diário no plano gratuito.'}
            </Text>

            {foco === 'STF' && (
              <View style={styles.badge}>
                <Feather name="lock" size={14} color="#fff" />
                <Text style={styles.badgeTxt}>Conteúdo Especial STF</Text>
              </View>
            )}

            {!isPremium && (
              <View style={styles.benefits}>
                <Benefit icon="infinity" text="Partidas ilimitadas nos módulos" />
                <Benefit icon="trending-up" text="Melhores métricas de desempenho" />
                <Benefit icon="bookmark" text="Progresso salvo" />
              </View>
            )}

            {isPremium ? (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={close}>
                <Text style={styles.btnGhostTxt}>Fechar</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={()=>handleUpgrade('premium_mensal')}>
                  <Feather name="star" size={16} color="#0a0f12" />
                  <Text style={styles.btnPrimaryTxt}>Assinar Mensal</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnOutline]} onPress={()=>handleUpgrade('premium_anual')}>
                  <Feather name="calendar" size={16} color="#ffd86b" />
                  <Text style={styles.btnOutlineTxt}>Assinar Anual</Text>
                </Pressable>
                <Pressable style={[styles.linkBtn]} onPress={close}>
                  <Text style={styles.linkTxt}>Continuar depois</Text>
                </Pressable>
              </>
            )}
        </LinearGradient>
      </View>
    </View>
  )
}

function Benefit({ icon, text }) {
  return (
    <View style={styles.benefitRow}>
      <Feather name={icon} size={14} color="#ffd86b" />
      <Text style={styles.benefitTxt}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay:{
    position:'absolute', top:0,left:0,right:0,bottom:0,
    backgroundColor:'#000c', justifyContent:'center', padding:28
  },
  cardWrap:{},
  card:{
    borderRadius:22,
    padding:22,
    borderWidth:1,
    borderColor:'#33515a',
    shadowColor:'#000', shadowOpacity:0.4, shadowRadius:14, elevation:12
  },
  headerRow:{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:10 },
  title:{ color:'#fff', fontSize:18, fontWeight:'700', flexShrink:1 },
  subtitle:{ color:'#cfe7f0', fontSize:13, lineHeight:18, marginBottom:12 },
  badge:{
    flexDirection:'row', alignItems:'center', gap:6,
    backgroundColor:'#ff7e2d33', borderColor:'#ff9b55',
    borderWidth:1, paddingHorizontal:10, paddingVertical:6,
    borderRadius:14, alignSelf:'flex-start', marginBottom:14
  },
  badgeTxt:{ color:'#ffbf85', fontSize:12, fontWeight:'600' },
  benefits:{ marginBottom:18, gap:6 },
  benefitRow:{ flexDirection:'row', alignItems:'center', gap:8 },
  benefitTxt:{ color:'#e2f4fa', fontSize:13 },
  btn:{
    flexDirection:'row', alignItems:'center', justifyContent:'center',
    paddingVertical:12, borderRadius:14, gap:8, marginBottom:12
  },
  btnPrimary:{ backgroundColor:'#ffd86b' },
  btnPrimaryTxt:{ color:'#0a0f12', fontSize:15, fontWeight:'700' },
  btnOutline:{ borderWidth:1, borderColor:'#ffd86b33', backgroundColor:'#ffffff10' },
  btnOutlineTxt:{ color:'#ffd86b', fontSize:15, fontWeight:'600' },
  btnGhost:{ backgroundColor:'#ffffff15', marginTop:8 },
  btnGhostTxt:{ color:'#e2f4fa', fontSize:15, fontWeight:'600' },
  linkBtn:{ alignSelf:'center', paddingVertical:4, paddingHorizontal:8, marginTop:2 },
  linkTxt:{ color:'#9fbcc6', fontSize:12, textDecorationLine:'underline' }
})