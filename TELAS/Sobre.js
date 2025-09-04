import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

// Componente para os cards de características
const FeatureCard = ({ icon, title, text, delay }) => {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(50)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, delay, useNativeDriver: true }).start();
    Animated.timing(slideAnim, { toValue: 0, duration: 500, delay, useNativeDriver: true }).start();
  }, [fadeAnim, slideAnim, delay]);

  return (
    <Animated.View style={[styles.featureCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <Feather name={icon} size={28} color="#00d3aa" />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </Animated.View>
  );
};

export default function Sobre({ navigation }) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#0f2027', '#203a43', '#2c5364']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Sobre o SigmaIQ</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <Image source={require('../assets/icon.png')} style={styles.logo} />
          <Text style={styles.mainTitle}>O Início da sua Jornada Intelectual</Text>
          <Text style={styles.mainParagraph}>
            Essa é uma plataforma criada pela Sigma Society, dedicada a mentes curiosas e ávidas por desafios. Nosso objetivo é estimular seu cérebro, aprimorar seu raciocínio lógico e expandir seu potencial intelectual através de testes e jogos envolventes.
          </Text>

          <View style={styles.featuresContainer}>
            <FeatureCard
              icon="zap"
              title="Desafios Estimulantes"
              text="Enfrente testes que avaliam sua lógica, memória e velocidade de pensamento."
              delay={200}
            />
            <FeatureCard
              icon="trending-up"
              title="Acompanhe seu Progresso"
              text="Veja sua evolução, compare resultados e descubra seus pontos fortes."
              delay={400}
            />
            <FeatureCard
              icon="globe"
              title="O Futuro é Colaborativo"
              text="Este é o primeiro passo. Em breve, lançaremos mais ferramentas, rankings e uma comunidade para você se conectar."
              delay={600}
            />
          </View>

          <Text style={styles.footerText}>
            Divirta-se. Desafie-se. Evolua.
          </Text>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },
  header: { paddingTop: 56, paddingBottom: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  backButton: { position: 'absolute', left: 22, top: 56 },
  headerTitle: { fontSize: 22, color: '#fff', fontWeight: '700' },
  scrollContainer: { paddingHorizontal: 22, paddingBottom: 40, alignItems: 'center' },
  
  logo: { width: 80, height: 80, borderRadius: 16, marginTop: 20, marginBottom: 20 },
  mainTitle: { fontSize: 26, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 12 },
  mainParagraph: { fontSize: 16, color: '#d1e8ff', textAlign: 'center', lineHeight: 24, marginBottom: 30 },

  featuresContainer: { width: '100%' },
  featureCard: { backgroundColor: '#ffffff10', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  featureTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginTop: 10, marginBottom: 6 },
  featureText: { fontSize: 15, color: '#d1e8ff', textAlign: 'center', lineHeight: 22 },

  footerText: { marginTop: 30, fontSize: 16, fontStyle: 'italic', color: '#00d3aa' },
});