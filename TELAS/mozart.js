import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';

// --- Hook de áudio (sem alterações) ---
function useMozartAudio() {
  const soundRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState({
    isPlaying: false,
    positionMillis: 0,
    durationMillis: 1,
  });

  useEffect(() => {
    let mounted = true;
    const loadSound = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: true, // <-- aqui!
          shouldDuckAndroid: true,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('../assets/Mozart.mp3'),
          { shouldPlay: false, volume: 1.0 }
        );
        if (mounted) {
          sound.setOnPlaybackStatusUpdate(status => {
            if (status.isLoaded) setPlaybackStatus(status);
          });
          soundRef.current = sound;
          setLoaded(true);
        } else {
          sound.unloadAsync();
        }
      } catch (e) {
        console.error("Erro ao carregar áudio:", e);
        setLoaded(false);
      }
    };
    loadSound();
    return () => {
      mounted = false;
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  const togglePlayPause = async () => {
    if (!soundRef.current) return;
    if (playbackStatus.isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      if (playbackStatus.positionMillis >= playbackStatus.durationMillis - 100) { // Se estiver no final
        await soundRef.current.replayAsync();
      } else {
        await soundRef.current.playAsync();
      }
    }
  };

  const stop = async () => {
    if (soundRef.current) await soundRef.current.stopAsync();
  };

  return { togglePlayPause, stop, loaded, playbackStatus };
}

// --- Componente de Card de Informação com animação ---
const InfoCard = ({ icon, title, children, delay = 0 }) => {
  const entryAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entryAnim, {
      toValue: 1,
      duration: 700,
      delay,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line
  }, []);

  return (
    <Animated.View style={[styles.card, { 
      opacity: entryAnim, 
      transform: [{ translateY: entryAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] 
    }]}>
      <View style={styles.cardHeader}>
        <Feather name={icon} size={22} color="#00d3aa" />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </Animated.View>
  );
};

// --- Tela principal ---
export default function Mozart({ navigation }) {
  const { togglePlayPause, stop, loaded, playbackStatus } = useMozartAudio();
  const { width } = Dimensions.get('window');
  const progress = (playbackStatus.positionMillis / playbackStatus.durationMillis) || 0;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const entryAnim = useRef(new Animated.Value(0)).current; // Animação principal de entrada

  useEffect(() => {
    Animated.timing(entryAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
    return stop;
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 150,
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line
  }, [progress]);

  const formatTime = (millis) => {
    if (!millis) return '00:00';
    const totalSeconds = Math.floor(millis / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <LinearGradient colors={['#232526', '#414345']} style={styles.container}>
      {/* Elementos decorativos animados */}
      <Animated.View style={[styles.notesWrap, { opacity: entryAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) }]}>
        <Feather name="music" size={28} color="#ffd166" style={[styles.note, { left: width * 0.18, top: 10 }]} />
        <Feather name="music" size={22} color="#00d3aa" style={[styles.note, { left: width * 0.7, top: 30 }]} />
        <Feather name="music" size={18} color="#fff" style={[styles.note, { left: width * 0.5, top: 60 }]} />
      </Animated.View>

      <TouchableOpacity style={styles.backBtn} onPress={() => { stop(); navigation.goBack(); }}>
        <Feather name="arrow-left" size={26} color="#fff" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Animated.View style={{ opacity: entryAnim }}>
          <Text style={styles.title}>Efeito Mozart</Text>
          <Text style={styles.subtitle}>A ciência por trás da música</Text>
        </Animated.View>

        <InfoCard icon="book-open" title="O Estudo" delay={200}>
          <Text style={styles.cardText}>
            Em 1993, um estudo pioneiro investigou a relação entre ouvir música clássica e o desempenho cognitivo, especificamente em tarefas de raciocínio espacial.
          </Text>
        </InfoCard>

        <InfoCard icon="file-text" title="A Referência" delay={350}>
          <Text style={styles.cardText}>
            Rauscher, Shaw e Ky (1993) — <Text style={{ fontStyle: 'italic' }}>Music and Spatial Task Performance</Text>, publicado na prestigiada revista Nature em 14 de outubro de 1993.
          </Text>
        </InfoCard>

        <InfoCard icon="award" title="O Resultado" delay={500}>
          <Text style={styles.cardText}>
            Após ouvir a música de Mozart por 10 minutos, os participantes tiveram desempenho superior em tarefas de raciocínio espaço-temporal (como parte do teste Stanford‑Binet), comparado às outras duas condições (silêncio ou áudio de relaxamento).
          </Text>
        </InfoCard>
      </ScrollView>

      {/* Player de Áudio Fixo no Rodapé */}
      <Animated.View style={[styles.playerContainer, {
        transform: [{ translateY: entryAnim.interpolate({ inputRange: [0, 1], outputRange: [150, 0] }) }]
      }]}>
        <TouchableOpacity
          style={[styles.audioBtn, !loaded && { backgroundColor: '#888' }]}
          onPress={togglePlayPause}
          disabled={!loaded}
          activeOpacity={0.8}
        >
          <Feather name={playbackStatus.isPlaying ? "pause" : "play"} size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.progressContainer}>
          <View style={styles.timeLabels}>
            <Text style={styles.timeText}>{formatTime(playbackStatus.positionMillis)}</Text>
            <Text style={styles.timeText}>{formatTime(playbackStatus.durationMillis)}</Text>
          </View>
          <View style={styles.progressBarOuter}>
            <Animated.View style={[styles.progressBarInner, { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContainer: { paddingHorizontal: 22, paddingBottom: 150, paddingTop: 56 },
  backBtn: { position: 'absolute', left: 18, top: 56, zIndex: 10, padding: 8 },
  title: { fontSize: 32, color: '#fff', fontWeight: 'bold', marginTop: 16, marginBottom: 6, textAlign: 'center', letterSpacing: 1 },
  subtitle: { fontSize: 18, color: '#b2c7d3', marginBottom: 24, textAlign: 'center' },
  card: { backgroundColor: '#ffffff08', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#ffffff1A' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardTitle: { color: '#00d3aa', fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  cardText: { color: '#d1e8ff', fontSize: 15, lineHeight: 22 },
  playerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderColor: '#ffffff20'
  },
  audioBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#00d3aa',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 18,
    shadowColor: '#00d3aa',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  progressContainer: { flex: 1, justifyContent: 'center' },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  timeText: { color: '#b2c7d3', fontSize: 12 },
  progressBarOuter: { height: 6, backgroundColor: '#ffffff20', borderRadius: 3, overflow: 'hidden' },
  progressBarInner: { height: '100%', backgroundColor: '#ffd166', borderRadius: 3 },
  notesWrap: { position: 'absolute', width: '100%', height: 100, left: 0, top: 0, zIndex: -1 },
  note: { position: 'absolute' }
});