import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  TouchableOpacity
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

// --- DADOS DOS CARDS ---
const CLASSIFICACOES = [
  {
    id: '1',
    classificacao: 'Gênio',
    faixa: 'Acima de 140',
    icone: 'award',
    corIcone: '#f1c40f',
    descricao: 'Capacidade excepcional de pensamento abstrato, criatividade e resolução de problemas complexos. Potencial para grandes inovações em ciência, arte ou tecnologia.'
  },
  {
    id: '2',
    classificacao: 'Superdotação',
    faixa: '130 - 139',
    icone: 'cpu',
    corIcone: '#00d3aa',
    descricao: 'Facilidade extrema para aprender e dominar conceitos avançados. Geralmente se destacam em carreiras acadêmicas, pesquisa e liderança estratégica.'
  },
  {
    id: '3',
    classificacao: 'Superior',
    faixa: '120 - 129',
    icone: 'book-open',
    corIcone: '#3498db',
    descricao: 'Aprendizagem rápida e excelente capacidade de julgamento. São ótimos em planejamento, gerenciamento e profissões que exigem alto nível de formação.'
  },
  {
    id: '4',
    classificacao: 'Médio Superior',
    faixa: '110 - 119',
    icone: 'trending-up',
    corIcone: '#e67e22',
    descricao: 'Acima da média, com boa capacidade para lidar com tarefas complexas e ensino superior. Comuns em cargos técnicos, gerenciais e especializados.'
  },
  {
    id: '5',
    classificacao: 'Médio',
    faixa: '90 - 109',
    icone: 'users',
    corIcone: '#ecf0f1',
    descricao: 'Faixa que abrange a maioria da população. Capacidade para concluir o ensino médio e desempenhar a grande maioria das profissões existentes.'
  },
  {
    id: '6',
    classificacao: 'Médio Inferior',
    faixa: '80 - 89',
    icone: 'trending-down',
    corIcone: '#95a5a6',
    descricao: 'Aprendizagem mais lenta, mas com capacidade para atividades práticas e rotineiras. Podem precisar de mais tempo para dominar novas habilidades.'
  },
  {
    id: '7',
    classificacao: 'Limítrofe (Borderline)',
    faixa: '70 - 79',
    icone: 'alert-triangle',
    corIcone: '#f39c12',
    descricao: 'Dificuldades de aprendizagem escolar, mas com capacidade para atividades vocacionais simples e autocuidado. Geralmente necessitam de alguma supervisão.'
  },
  {
    id: '8',
    classificacao: 'Deficiência Intelectual',
    faixa: 'Abaixo de 70',
    icone: 'x-circle',
    corIcone: '#e74c3c',
    descricao: 'Necessitam de apoio substancial em diversas áreas da vida, como aprendizado, comunicação e cuidados pessoais. O nível de apoio varia conforme a faixa.'
  }
];

// --- COMPONENTE DO CARD (Cada item da lista) ---
const CardQI = ({ item, index }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      delay: index * 150,
      useNativeDriver: true,
    }).start();
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 600,
      delay: index * 150,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, slideAnim, index]);

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={[styles.iconContainer, { backgroundColor: `${item.corIcone}20` }]}>
        <Feather name={item.icone} size={32} color={item.corIcone} />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.cardTitle}>{item.classificacao}</Text>
        <Text style={styles.cardRange}>QI: {item.faixa}</Text>
        <Text style={styles.cardDescription}>{item.descricao}</Text>
      </View>
    </Animated.View>
  );
};

// --- COMPONENTE PRINCIPAL DA TELA ---
export default function ClassificacaoQI({ navigation }) {
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
          <Text style={styles.headerTitle}>Classificações de QI</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {CLASSIFICACOES.map((item, index) => (
            <CardQI key={item.id} item={item} index={index} />
          ))}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

// --- FOLHA DE ESTILOS ---
const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1 },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 22,
    top: 56,
  },
  headerTitle: {
    fontSize: 22,
    color: '#fff',
    fontWeight: '700',
  },
  scrollContainer: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#ffffff10',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ffffff20',
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  cardRange: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00d3aa',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  cardDescription: {
    fontSize: 15,
    color: '#d1e8ff',
     lineHeight: 22,
  },
});
