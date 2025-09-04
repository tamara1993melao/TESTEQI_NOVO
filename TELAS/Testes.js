import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import PaywallModal from './PaywallModal';

const CardTesteOficial = ({ onPress }) => (
  <TouchableOpacity activeOpacity={0.92} onPress={onPress}>
    <LinearGradient
      colors={['#00d3aa', '#00b894']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.cardOficial}
    >
      <View style={styles.ribbon}>
        <Feather name="award" size={14} color="#0a0f12" />
        <Text style={styles.ribbonText}>Oficial</Text>
      </View>

      <View style={styles.cardOficialGlass}>
        <View style={styles.cardHeader}>
          <Feather name="zap" size={22} color="#ffffff" />
          <Text style={styles.cardOficialTitle}>SIGMA TEST FAST</Text>
        </View>
        <Text style={styles.cardOficialSubtitle}>O Teste de QI Oficial</Text>

        <View style={styles.infoChips}>
          <View style={styles.chip}>
            <Feather name="clock" size={14} color="#fff" />
            <Text style={styles.chipText}>40 min</Text>
          </View>
          {/* removido "60 questões" */}
          <View style={styles.chip}>
            <Feather name="shield" size={14} color="#fff" />
            <Text style={styles.chipText}>Alta precisão</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.cardButtonPrimary} onPress={onPress} activeOpacity={0.9}>
          <Feather name="play-circle" size={18} color="#0a0f12" />
          <Text style={styles.cardButtonPrimaryText}>Começar agora</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  </TouchableOpacity>
)

// Cartão de nível padrão
const CardNivel = ({ icone, nivel, titulo, status, cor, bloqueado = false, onPress, descricao }) => (
  <TouchableOpacity style={[styles.cardNivel, bloqueado && styles.cardBloqueado]} disabled={bloqueado} onPress={onPress}>
    <Feather name={icone} size={32} color={cor} style={styles.nivelIcone} />
    <View style={styles.nivelTextContainer}>
      <Text style={styles.nivelTitulo}>{`Nível ${nivel}: ${titulo}`}</Text>
      {descricao && <Text style={styles.nivelDescricao}>{descricao}</Text>}
      <Text style={[styles.nivelStatus, { color: cor }]}>{status}</Text>
    </View>
    <Feather name={bloqueado ? 'lock' : 'play-circle'} size={28} color="#ffffff80" />
  </TouchableOpacity>
);

export default function Testes({ navigation }) {
  const [isModalVisible, setModalVisible] = useState(false);
  const route = useRoute();
  const startOn = route?.params?.startOn;
  const autoOpenedRef = useRef(false);
  
  const handleConfirmPurchase = () => {
    setModalVisible(false);
    navigation.navigate('STF');
  };

  // Se veio do Perfil com startOn: 'STF', abre o paywall automaticamente (uma vez)
  useEffect(() => {
    if (startOn === 'STF' && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setModalVisible(true);
    }
  }, [startOn]);

  // Back seguro: volta se puder; senão, vai para Home
  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Home');
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#0f2027', '#203a43', '#2c5364']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Testes e Treinos</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('RecordsHub')}
            style={styles.recordsButton}
            accessibilityLabel="Ver recordes"
          >
            <Feather name="award" size={24} color="#ffd166" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {/* Card convite Efeito Mozart */}
          <TouchableOpacity
            style={styles.mozartCard}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('Mozart')}
          >
            <Feather name="music" size={28} color="#ffd166" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.mozartTitle}>Efeito Mozart</Text>
              <Text style={styles.mozartDesc}>
                Ouça Mozart antes do teste e veja como seu cérebro responde! Toque para saber mais.
              </Text>
            </View>
            <Feather name="chevron-right" size={24} color="#ffd166" />
          </TouchableOpacity>

          {/* Card oficial aprimorado */}
          <CardTesteOficial onPress={() => navigation.navigate('STF')} />

          {/* Título da seção com formatação melhor */}
          <Text style={styles.sectionTitle}>Modo Desafio</Text>

          {/* ThinkFast com brilho do Mozart, “Liberado” abaixo e ícone play como os níveis */}
          <TouchableOpacity
            style={styles.thinkFastCard}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('ThinkFast')}
          >
            <Feather name="zap" size={28} color="#00d3aa" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.thinkFastTitle}>Nível ThinkFast</Text>
              <Text style={styles.thinkFastDesc}>Mede tempo de reação e atenção visual.</Text>
              <Text style={[styles.nivelStatus, { color: '#00d3aa', marginTop: 6 }]}>Liberado</Text>
            </View>
            <Feather name="play-circle" size={28} color="#ffffff80" />
          </TouchableOpacity>

          {/* ADIÇÃO: Card ThinkFast 90 */}
          <TouchableOpacity
            style={styles.thinkFastCard}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('ThinkFast90')}
          >
            <Feather name="target" size={28} color="#ffd166" style={{ marginRight: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.thinkFastTitle}>Nível ThinkFast Anos 90</Text>
              <Text style={styles.thinkFastDesc}>Um clássico em avaliação de reação do cérebro.</Text>
              <Text style={[styles.nivelStatus, { color: '#ffd166', marginTop: 6 }]}>Liberado</Text>
            </View>
            <Feather name="play-circle" size={28} color="#ffffff80" />
          </TouchableOpacity>

          {/* Demais níveis */}
          <CardNivel
            icone="unlock"
            nivel={1}
            titulo="Sequência de números"
            descricao="Teste de raciocínio lógico"
            status="Liberado"
            cor="#00d3aa"
            onPress={() => navigation.navigate('Nivel1')}
          />
          <CardNivel
            icone="unlock"
            nivel={2}
            titulo="Procurar Símbolos"
            descricao="Teste de memória operacional"
            status="Liberado"
            cor="#e67e22"
            onPress={() => navigation.navigate('Nivel2ProcurarSimbolos')}
          />
          <CardNivel
            icone="unlock"
            nivel={3}
            titulo="Matrizes"
            descricao="Padrões e raciocínio indutivo"
            status="Liberado"
            cor="#e74c3c"
            onPress={() => navigation.navigate('Matrizes')}
          />
          <CardNivel
            icone="unlock"
            nivel={4}
            titulo="Personalidades"
            descricao="Teste de criatividade e cultura"
            status="Liberado"
            cor="#9b59b6"
            liberado
            //pode colocar bloqueado
            onPress={() => navigation.navigate('QuizPersonalidades')}
          />

          <View style={styles.dailyChallenge}>
            <Feather name="gift" size={24} color="#f1c40f" />
            <Text style={styles.dailyChallengeText}>
              Desbloqueie todos desafios e tente quebrar o seu recorde e do aplicativo
            </Text>
          </View>
        </ScrollView>

        <PaywallModal
          visible={isModalVisible}
          onClose={() => setModalVisible(false)}
          onConfirm={handleConfirmPurchase}
        />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },
  header: { paddingTop: 56, paddingBottom: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  backButton: { position: 'absolute', left: 22, top: 56 },
  recordsButton: { position: 'absolute', right: 22, top: 56 },
  headerTitle: { fontSize: 22, color: '#fff', fontWeight: '700' },
  scrollContainer: { paddingHorizontal: 16, paddingBottom: 40 },

  // Mozart Card
  mozartCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232526',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ffd16655',
    shadowColor: '#ffd166',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  mozartTitle: { color: '#ffd166', fontWeight: 'bold', fontSize: 17, marginBottom: 2 },
  mozartDesc: { color: '#fff', fontSize: 13, opacity: 0.85 },

  // Oficial (gradiente + “glass” interno)
  cardOficial: {
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffffff22',
    shadowColor: '#00d3aa',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  cardOficialGlass: {
    backgroundColor: 'rgba(8,12,20,0.45)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
  },
  ribbon: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#ffd166',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 2,
  },
  ribbonText: { color: '#0a0f12', fontWeight: '800', fontSize: 12, marginLeft: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardOficialTitle: { fontSize: 20, color: '#fff', fontWeight: '900', marginLeft: 10, letterSpacing: 0.3 },
  cardOficialSubtitle: { fontSize: 14, color: '#ffffffd9', marginBottom: 14 },

  infoChips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 },
  chip: {
    backgroundColor: '#ffffff22',
    borderColor: '#ffffff30',
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 12, marginLeft: 6 },

  cardButtonPrimary: {
    backgroundColor: '#ffd166',
    borderRadius: 26,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cardButtonPrimaryText: { color: '#0a0f12', fontSize: 16, fontWeight: '800', marginLeft: 8 },

  // Título da seção
  sectionTitle: {
    color: '#b2c7d3',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 12,
    paddingHorizontal: 2,
  },

  // ThinkFast com brilho como o Mozart
  thinkFastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232526',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#00d3aa55',
    shadowColor: '#00d3aa',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  thinkFastTitle: { color: '#00d3aa', fontWeight: 'bold', fontSize: 17, marginBottom: 2 },
  thinkFastDesc: { color: '#fff', fontSize: 13, opacity: 0.85 },

  // Níveis
  cardNivel: { backgroundColor: '#ffffff10', borderRadius: 16, padding: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#ffffff20' },
  cardBloqueado: { opacity: 0.6 },
  nivelIcone: { marginRight: 16 },
  nivelTextContainer: { flex: 1 },
  nivelTitulo: { fontSize: 17, color: '#fff', fontWeight: 'bold' },
  nivelDescricao: { fontSize: 13, color: '#ffffffa0', marginTop: 2, marginBottom: 4 },
  nivelStatus: { fontSize: 13, fontWeight: '600' },

  dailyChallenge: { marginTop: 0, padding: 16, backgroundColor: '#f1c40f20', borderRadius: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#f1c40f50' },
  dailyChallengeText: { flex: 1, marginLeft: 12, color: '#f1c40f', fontSize: 14, lineHeight: 20 },
});
// acabou