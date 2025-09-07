import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';

const START_SOUND = require('../../assets/start.mp3');

export default function Hub({ navigation }) {
  const soundRef = useRef(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 400; // lado a lado em telas um pouco mais largas

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const playStartAndNavigate = useCallback(async (routeName) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync(START_SOUND, { volume: 0.8 });
      soundRef.current = sound;
      await sound.playAsync();
    } catch (e) {
      // silencioso
    } finally {
      setTimeout(() => navigation.navigate(routeName), 120);
    }
  }, [navigation]);

  const ModeCard = ({ title, desc, icon, color, onPress }) => (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={[styles.cardWrap, isWide && styles.cardWrapWide]}>
      <View style={[styles.card, { borderColor: `${color}55`, shadowColor: color }]}>
        <Feather name={icon} size={28} color={color} style={styles.cardIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color }]}>{title}</Text>
          <Text style={styles.cardDesc}>{desc}</Text>
        </View>
        <Feather name="chevron-right" size={24} color="#ffffff80" />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Personalidades</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Perfil')} style={styles.profileButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="user" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.title}>Modos de Desafio</Text>
          <Text style={styles.subtitle}>Teste seu conhecimento sobre grandes mentes.</Text>
        </View>

        {/* Cards */}
        <View style={[styles.list, isWide && styles.listRow]}>
          <ModeCard
            title="Adivinhe quem é"
            desc="3 pistas, 4 opções. Acerte a personalidade."
            icon="help-circle"
            color="#00d3aa"
            onPress={() => playStartAndNavigate('Adivinhe')}
          />
          <ModeCard
            title="Quem tem o QI mais alto?"
            desc="Compare duas personalidades e escolha a de maior QI."
            icon="trending-up"
            color="#ffd166"
            onPress={() => playStartAndNavigate('IQ')}
          />
        </View>

        {/* Rodapé leve */}
        <Text style={styles.footerHint}>Recordes disponíveis no hub de testes.</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  backButton: { position: 'absolute', left: 22, top: 56, padding: 6 },
  profileButton: { position: 'absolute', right: 22, top: 56, padding: 6 },
  headerTitle: { fontSize: 22, color: '#fff', fontWeight: '700' },

  hero: { paddingHorizontal: 20, marginTop: 16, marginBottom: 12, alignItems: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#b2c7d3', marginTop: 6, fontSize: 15, textAlign: 'center' },

  list: { paddingHorizontal: 16, marginTop: 20, gap: 16 },
  listRow: { flexDirection: 'row' },

  cardWrap: { width: '100%' },
  cardWrapWide: { flex: 1 },
  card: {
    backgroundColor: '#232526', // Fundo escuro como em Testes.js
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    // Sombra e borda coloridas para efeito neon
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  cardIcon: {
    marginRight: 14,
  },
  cardTitle: {
    // Cor virá da prop
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  cardDesc: {
    color: '#fff', // Texto branco
    opacity: 0.85,
    fontSize: 13,
  },
  footerHint: { textAlign: 'center', color: '#7fa6bd', marginTop: 26, marginBottom: 20, fontSize: 13 }
});