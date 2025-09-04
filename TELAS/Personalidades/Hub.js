import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';

const START_SOUND = require('../../assets/start.mp3');

export default function Hub({ navigation }) {
  const soundRef = useRef(null);

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
      // navega logo após tocar (sem bloquear)
      setTimeout(() => navigation.navigate(routeName), 120);
    }
  }, [navigation]);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.gradient}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}> Personalidades</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Perfil')} style={styles.profileButton}>
            <Feather name="user" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Intro */}
        <View style={styles.intro}>
          <Text style={styles.title}>Escolha um modo</Text>
          <Text style={styles.subtitle}>Teste cultura, lógica e reconhecimento.</Text>
        </View>

        {/* Cards */}
        <View style={styles.list}>
          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.card, { borderColor: '#00d3aa55' }]}
            onPress={() => playStartAndNavigate('Adivinhe')}
          >
            <Feather name="help-circle" size={28} color="#00d3aa" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: '#00d3aa' }]}>Adivinhe quem é</Text>
              <Text style={styles.cardDesc}>3 pistas, 5 opções. Acerte o nome da personalidade.</Text>
            </View>
            <Feather name="chevron-right" size={24} color="#ffffff80" />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.card, { borderColor: '#ffd16655' }]}
            onPress={() => playStartAndNavigate('IQ')}
          >
            <Feather name="trending-up" size={28} color="#ffd166" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: '#ffd166' }]}>Quem tem o QI mais alto?</Text>
              <Text style={styles.cardDesc}>Compare duas personalidades e escolha a de maior QI.</Text>
            </View>
            <Feather name="chevron-right" size={24} color="#ffffff80" />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.card, { borderColor: '#a78bfa55' }]}
            onPress={() => playStartAndNavigate('Connections')}
          >
            <Feather name="link-2" size={28} color="#a78bfa" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: '#a78bfa' }]}>Conexões</Text>
              <Text style={styles.cardDesc}>O que 2 nomes têm em comum? Área, região, campo e mais.</Text>
            </View>
            <Feather name="chevron-right" size={24} color="#ffffff80" />
          </TouchableOpacity>
        </View>
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
  headerTitle: { fontSize: 22, color: '#fff', fontWeight: '800' },
  intro: { paddingHorizontal: 16, marginTop: 18},
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  subtitle: { color: '#b2c7d3', marginTop: 14},
  list: { paddingHorizontal: 16, marginTop: 32, gap: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232526',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3
  },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  cardDesc: { color: '#ffffffcc', fontSize: 13, marginTop: 4 }
});