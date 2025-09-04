import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, Modal, Linking
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import { supabase } from '../supabaseClient';
// >>> GATING (novos imports)
import { usePlano } from '../planoContext';
import { tentarUsar } from '../core/gatingLocal';
import { usePaywall } from '../paywallContext';

// Componente visual do certificado que será salvo como imagem
const ResultadoCertificado = React.forwardRef(({ nome, qi, acertos, totalQuestoes }, ref) => (
  <ViewShot ref={ref} options={{ format: 'png', quality: 1.0 }}>
    <LinearGradient colors={['#2c5364', '#203a43', '#0f2027']} style={styles.certificateContainer}>
      <Image source={require('../assets/icon.png')} style={styles.certificateLogo} />
      <Text style={styles.certificateTitle}>RELATÓRIO DE DESEMPENHO</Text>
      <Text style={styles.certificateSubtitle}>SIGMA TEST FAST</Text>
      
      <View style={styles.certificateBody}>
        <Text style={styles.certificateName}>{nome}</Text>
        <Text style={styles.certificateLabel}>obteve o seguinte resultado:</Text>
        <Text style={styles.certificateQiValue}>{qi}</Text>
        <Text style={styles.certificateQiLabel}>QI Estimado</Text>
        <Text style={styles.certificateScore}>Pontuação: {acertos} / {totalQuestoes} acertos</Text>
      </View>

      <Text style={styles.certificateFooter}>www.sigmasociety.net</Text>
    </LinearGradient>
  </ViewShot>
));


export default function STF({ navigation }) {
  const [step, setStep] = useState('form');
  const [isLoading, setIsLoading] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [participantData, setParticipantData] = useState({});
  const [jaFezQI, setJaFezQI] = useState(null);
  const [testesqi, setTestesqi] = useState('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState(Array(questions.length).fill(null))
  const [timeRemaining, setTimeRemaining] = useState(40 * 60);
  const timerRef = useRef(null);
  const viewShotRef = useRef();
  const [showPromo, setShowPromo] = useState(false);

  // >>> GATING estado/hooks
  const { plano } = usePlano();
  const { open: openPaywall } = usePaywall();
  const [gatingChecking, setGatingChecking] = useState(true);
  const [gatingOK, setGatingOK] = useState(false);

  // >>> GATING verificação de compra única ao montar
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        console.log('[STF][gating] verificar acesso plano=', plano);
        // parâmetro { apenasVerificar:true } (se sua função ignorar, ela só tentará usar; como compra única deve sempre retornar ok sem consumir “limite”)
        const r = await tentarUsar('STF', plano, { apenasVerificar: true });
        console.log('[STF][gating] resposta', r);
        if (!alive) return;
        if (!r.ok) {
          if (r.erro === 'nao_logado') {
            Alert.alert('Login necessário', 'Entre para acessar o teste.');
            navigation.navigate && navigation.navigate('Login');
          } else if (r.erro === 'compra_unica_necessaria') {
            openPaywall('STF');
            // opcional: voltar automaticamente
            navigation.goBack && navigation.goBack();
          } else if (r.erro === 'limite') {
            // Se tiver limite_free=0 e não marcou compra_unica corretamente, trate como compra necessária
            openPaywall('STF');
            navigation.goBack && navigation.goBack();
          } else {
            // outros erros silenciam
          }
        } else {
          setGatingOK(true);
        }
      } catch (e) {
        console.log('[STF][gating] erro', e);
        Alert.alert('Erro', 'Falha ao verificar acesso.');
        navigation.goBack && navigation.goBack();
      } finally {
        if (alive) setGatingChecking(false);
      }
    })();
    return () => { alive = false; };
  }, [plano, navigation, openPaywall]);

  const handleSaveResult = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert("Permissão necessária", "Precisamos de permissão para salvar a imagem na sua galeria.");
      return;
    }

    try {
      const uri = await viewShotRef.current.capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Sucesso!", "Seu resultado foi salvo na galeria de fotos.");
    } catch (error) {
      console.error("Erro ao salvar imagem:", error);
      Alert.alert("Erro", "Não foi possível salvar a imagem.");
    }
  };
  

  useEffect(() => {
    if (step === 'question' && timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (timeRemaining <= 0 && step === 'question') {
      clearInterval(timerRef.current);
      Alert.alert("Tempo Esgotado!", "Seu teste será finalizado agora.", [{ text: "OK", onPress: finalizeTest }]);
    }
    return () => clearInterval(timerRef.current);
  }, [step, timeRemaining]);

  useEffect(() => {
    if (step === 'result') {
      const t = setTimeout(() => setShowPromo(true), 5000) // 10s
      return () => clearTimeout(t)
    } else {
      setShowPromo(false)
    }
  }, [step])

  const handleParticipantData = async () => {
    if (!nome || !email || !nascimento) {
      Alert.alert("Erro", "Por favor, preencha todos os campos.");
      return;
    }
    setIsLoading(true);
    try {
      setParticipantData({ nome, email, nascimento, dataTeste: new Date().toISOString() });
      setStep('previousTests');
    } catch (error) {
      Alert.alert("Erro de Rede", "Não foi possível verificar o email.");
    } finally {
      setIsLoading(false);
    }
  };

  const startTest = () => {
    if (!gatingOK) {
      Alert.alert('Acesso bloqueado', 'É necessário adquirir o STF para iniciar.');
      openPaywall('STF');
      return;
    }
    setStep('question');
  };

  const selectAnswer = (answerIndex) => {
    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = answerIndex;
    setAnswers(newAnswers);
  };

  const navigateQuestion = (direction) => {
    if (direction === 'next') {
      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        const unansweredCount = answers.filter(a => a === null).length;
        if (unansweredCount > 0) {
          Alert.alert(
            "Atenção",
            `Você deixou ${unansweredCount} questão(ões) em branco. Deseja finalizar mesmo assim?`,
            [
              { text: "Voltar", style: "cancel" },
              { text: "Finalizar", onPress: finalizeTest, style: "destructive" }
            ]
          );
        } else {
          finalizeTest();
        }
      }
    } else if (direction === 'prev') {
      if (currentQuestionIndex > 0) {
        setCurrentQuestionIndex(prev => prev - 1);
      }
    }
  };

  // Formata "X minutos e Y segundos"
  const formatDuration = (totalSec) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const mm = m === 1 ? '1 minuto' : `${m} minutos`;
    const ss = s === 1 ? '1 segundo' : `${s} segundos`;
    return `${mm} e ${ss}`;
  };

  const finalizeTest = async () => {
    clearInterval(timerRef.current)
    const timeUsed = (40 * 60) - timeRemaining

    const selectedAnswers = questions.map((q, i) => {
      const idx = answers[i]
      return idx !== null ? q.alternatives[idx] : null
    })

    setIsLoading(true)
    try {
      const { data, error } = await supabase.rpc('stf_score_and_save', {
        _answers: selectedAnswers,
        _time_used_seconds: timeUsed,
        _nome: nome,
        _email: email,
        _nascimento: nascimento,
        _ja_fez_qi: jaFezQI === true,
        _testes_qi: jaFezQI ? testesqi : ''
      })
      if (error) {
        console.log('RPC erro', error.message)
        Alert.alert('Erro', 'Falha ao calcular. Tente novamente.')
        return
      }
      const res = data && data[0]
      setParticipantData(prev => ({
        ...prev,
        nome, email, nascimento,
        correctCount: res?.correct_count ?? 0,
        qi: res?.qi ?? 0,
        timeUsed,
        jaFezQI: jaFezQI === true,
        testesqi: jaFezQI ? testesqi : ''
      }))
      setStep('result')
    } finally {
      setIsLoading(false)
    }
  };

  const renderContent = () => {
    if (isLoading) return <ActivityIndicator size="large" color="#00d3aa" />;

    // Bloqueio visual enquanto verifica
    if (gatingChecking) {
      return (
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#00d3aa" />
          <Text style={{ color: '#fff', marginTop: 16 }}>Verificando acesso...</Text>
        </View>
      );
    }
    if (!gatingOK) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Feather name="lock" size={42} color="#00d3aa" style={{ marginBottom: 20 }} />
          <Text style={styles.title}>Acesso Restrito</Text>
          <Text style={styles.paragraph}>
            Este teste requer compra única (STF). Faça a aquisição para continuar.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => openPaywall('STF')}
          >
            <Text style={styles.buttonText}>Desbloquear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => navigation.goBack && navigation.goBack()}
          >
            <Text style={styles.buttonText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    switch (step) {
      case 'form':
        return (
          <>
            <Text style={styles.title}>Dados do Participante</Text>
            <TextInput style={styles.input} placeholder="Nome Completo" placeholderTextColor="#999" value={nome} onChangeText={setNome} />
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#999" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <TextInput style={styles.input} placeholder="Data de Nascimento (AAAA-MM-DD)" placeholderTextColor="#999" value={nascimento} onChangeText={setNascimento} />
            <TouchableOpacity style={styles.button} onPress={handleParticipantData}>
              <Text style={styles.buttonText}>Continuar</Text>
            </TouchableOpacity>
          </>
        );
      case 'previousTests':
        return (
          <>
            <Text style={styles.title}>Testes Cognitivos Anteriores</Text>
            <Text style={styles.paragraph}>
              Você já fez teste de QI antes?
            </Text>

            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, jaFezQI === true && styles.toggleSelected]}
                onPress={() => setJaFezQI(true)}
              >
                <Feather name="check-circle" size={16} color="#fff" />
                <Text style={styles.toggleTxt}>Sim</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toggleBtn, jaFezQI === false && styles.toggleSelected]}
                onPress={() => setJaFezQI(false)}
              >
                <Feather name="x-circle" size={16} color="#fff" />
                <Text style={styles.toggleTxt}>Não</Text>
              </TouchableOpacity>
            </View>

            {jaFezQI === true && (
              <TextInput
                style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
                placeholder="Conte aqui os escores e datas (ex.: WAIS 118 em 2022; Mensa 131 em 2023)"
                placeholderTextColor="#999"
                value={testesqi}
                onChangeText={setTestesqi}
                multiline
              />
            )}

            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                setParticipantData(prev => ({ ...prev, jaFezQI: jaFezQI === true, testesqi: jaFezQI ? testesqi : '' }));
                setStep('instructions');
              }}
              disabled={jaFezQI === null}
            >
              <Text style={styles.buttonText}>Continuar</Text>
            </TouchableOpacity>
          </>
        );
      case 'instructions':
        return (
          <>
            <Text style={styles.title}>Instruções</Text>
            <Text style={styles.paragraph}>Você terá 40 minutos para responder 40 questões. O teste só pode ser iniciado uma vez. Certifique-se de estar em um local tranquilo. Boa sorte!</Text>
            <TouchableOpacity style={styles.button} onPress={startTest}>
              <Text style={styles.buttonText}>Iniciar Teste</Text>
            </TouchableOpacity>
          </>
        );
      case 'question':
        const q = questions[currentQuestionIndex];
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        return (
          <>
            <View style={styles.timerContainer}>
              <Feather name="clock" size={20} color="#00d3aa" />
              <Text style={styles.timerText}>{`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`}</Text>
            </View>
            <Text style={styles.questionText}>{q.text}</Text>
            {q.image && <Image source={{ uri: q.image }} style={styles.questionImage} resizeMode="contain" />}
            {q.alternatives.map((alt, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.alternativeButton, answers[currentQuestionIndex] === index && styles.selectedAlternative]}
                onPress={() => selectAnswer(index)}
              >
                <Text style={styles.alternativeText}>{alt}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.navContainer}>
              <TouchableOpacity style={styles.navButton} onPress={() => navigateQuestion('prev')} disabled={currentQuestionIndex === 0}>
                <Text style={styles.buttonText}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButton} onPress={() => navigateQuestion('next')}>
                <Text style={styles.buttonText}>{currentQuestionIndex === questions.length - 1 ? 'Finalizar' : 'Avançar'}</Text>
              </TouchableOpacity>
            </View>
          </>
        );
      case 'result':
        return (
          <>
            <Text style={styles.title}>Seu Resultado</Text>
            <ResultadoCertificado
              ref={viewShotRef}
              nome={participantData.nome}
              qi={participantData.qi}
              acertos={participantData.correctCount}
              totalQuestoes={questions.length}
            />
            <TouchableOpacity style={styles.button} onPress={handleSaveResult}>
              <Feather name="download" size={18} color="#fff" style={{marginRight: 10}} />
              <Text style={styles.buttonText}>Salvar Imagem do Resultado</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.buttonText}>Voltar para o Início</Text>
            </TouchableOpacity>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        {renderContent()}
      </ScrollView>

      {/* Modal informativo após 10s do resultado */}
      <Modal
        visible={showPromo}
        transparent
        animationType="fade"
        onRequestClose={()=> setShowPromo(false)}
      >
        <View style={styles.promoBackdrop}>
          <View style={styles.promoCard}>
            <Text style={styles.promoTitle}>Recomendação</Text>
            <Text style={styles.promoMsg}>
              Para escores acima de 115, caso tenha interesse em uma avaliação mais acurada e completa para sua faixa de QI, é recomendável o STL.
              {'\n\n'}Para escores acima de 125 é altamente recomendável fazer o STL.
            </Text>
            {participantData?.qi != null && (
              <Text style={styles.promoQI}>
                Seu QI estimado: <Text style={styles.promoQIValue}>{participantData.qi}</Text>
              </Text>
            )}
            <View style={styles.promoBtns}>
              <TouchableOpacity
                style={[styles.promoBtn, { backgroundColor:'#ffffff22'}]}
                onPress={()=> setShowPromo(false)}
              >
                <Text style={styles.promoBtnTxt}>Fechar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.promoBtn, { backgroundColor:'#00d3aa'}]}
                onPress={()=>{
                  Linking.openURL('https://www.sigmasociety.net/sigma-teste-light')
                  setShowPromo(false)
                }}
              >
                <Text style={[styles.promoBtnTxt, {fontWeight:'700'}]}>Conhecer STL</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

// Estilos e Dados abaixo
const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 26, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  paragraph: { fontSize: 16, color: '#d1e8ff', textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  input: { backgroundColor: '#ffffff15', color: '#fff', borderRadius: 10, padding: 15, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#00d3aa', borderRadius: 30, padding: 16, alignItems: 'center', marginTop: 10, flexDirection: 'row', justifyContent: 'center' },
  secondaryButton: { backgroundColor: '#ffffff30' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  timerContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  timerText: { color: '#00d3aa', fontSize: 22, fontWeight: 'bold', marginLeft: 8 },
  questionText: { fontSize: 18, color: '#fff', textAlign: 'center', marginBottom: 20, lineHeight: 26 },
  questionImage: { width: '100%', height: 200, marginBottom: 20 },
  alternativeButton: { backgroundColor: '#ffffff15', borderRadius: 10, padding: 15, marginBottom: 10 },
  selectedAlternative: { backgroundColor: '#00d3aa', borderWidth: 2, borderColor: '#fff' },
  alternativeText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  navContainer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  navButton: { backgroundColor: '#ffffff30', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 30 },
  
  certificateContainer: { padding: 20, borderRadius: 15, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#00d3aa50' },
  certificateLogo: { width: 60, height: 60, borderRadius: 10, marginBottom: 15 },
  certificateTitle: { fontSize: 14, color: '#ffffffa0', letterSpacing: 2, textTransform: 'uppercase' },
  certificateSubtitle: { fontSize: 20, color: '#fff', fontWeight: 'bold', marginBottom: 20 },
  certificateBody: { alignItems: 'center', width: '100%', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#ffffff30', paddingVertical: 20, marginBottom: 20 },
  certificateName: { fontSize: 22, color: '#fff', fontWeight: 'bold' },
  certificateLabel: { fontSize: 14, color: '#d1e8ff', marginBottom: 10 },
  certificateQiValue: { fontSize: 60, color: '#00d3aa', fontWeight: 'bold' },
  certificateQiLabel: { fontSize: 16, color: '#00d3aa', fontWeight: '600', marginTop: -5, marginBottom: 15 },
  certificateScore: { fontSize: 14, color: '#d1e8ff' },
  certificateFooter: { fontSize: 12, color: '#ffffff80', fontStyle: 'italic' },

  promoBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.65)',justifyContent:'center',alignItems:'center',padding:24},
  promoCard:{width:'100%',backgroundColor:'#13252e',borderRadius:20,padding:22,borderWidth:1,borderColor:'#00d3aa40'},
  promoTitle:{color:'#00d3aa',fontSize:20,fontWeight:'700',marginBottom:12,textAlign:'center'},
  promoMsg:{color:'#d1e8ff',fontSize:14,lineHeight:20,marginBottom:16},
  promoQI:{color:'#fff',fontSize:14,marginBottom:18,textAlign:'center'},
  promoQIValue:{color:'#00d3aa',fontWeight:'700'},
  promoBtns:{flexDirection:'row',justifyContent:'space-between'},
  promoBtn:{flex:1,paddingVertical:14,borderRadius:14,alignItems:'center',marginHorizontal:4},
  promoBtnTxt:{color:'#fff',fontSize:14}
});

const questions = [
  { text: "1. Qual figura completa a sequência lógica: ⬛⬜⬛⬛⬜⬛⬛⬛⬜__?", image: null, alternatives: ["⬛", "⬜", "🔺", "⚫", "🔻"] },
  { text: "2. Qual símbolo vem a seguir nesta sequência: ▲▶▼◀▲▶__?", image: null, alternatives: ["▶", "▼", "◀", "▲", "◤"] },
  { text: "3. Complete a sequência: A, C, F, J, __?", image: null, alternatives: ["O", "P", "Q", "R", "T"] },
  { text: "4. Qual figura vem a seguir na sequência?", image: "https://static.wixstatic.com/media/38961e_d7932561aba84f12b58e3acde818ee44~mv2.jpg", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "5. Se 5 gatos pegam 5 ratos em 5 minutos, quantos gatos são necessários para pegar 100 ratos em 100 minutos?", image: null, alternatives: ["5", "10", "20", "100", "105"] },
  { text: "6. Qual palavra não pertence ao grupo: Casa, Carro, Árvore, Bicicleta, Chalé?", image: null, alternatives: ["Casa", "Carro", "Árvore", "Bicicleta", "Chalé"] },
  { text: "7. Qual figura vem a seguir? 🔵🟡🔵🟡🔵?", image: null, alternatives: ["🔵", "🟡", "🔺", "⚫", "⭙"] },
  { text: "8. Qual figura completa o padrão? 🔴🔵⚪🔴🔵⚪🔴🔵?", image: null, alternatives: ["⚪", "🔴", "🔵", "🟢", "⭙"] },
  { text: "9. Qual símbolo segue a lógica da sequência? ➕➖✖➕➖✖➕➖?", image: null, alternatives: ["✖", "➕", "➖", "➗", "◉"] },
  { text: "10. Qual é o número ausente na sequência: 1, 1, 2, 3, 5, __, 13?", image: null, alternatives: ["7", "8", "9", "10", "17"] },
  { text: "11. Qual símbolo vem a seguir nesta sequência: ▶️▲◀️▼▶️▲__?", image: null, alternatives: ["◀️", "▼", "▶️", "▲", "⬛"] },
  { text: "12. Se 🦊 + 🐰 = 10, 🦊 + 🐻 = 12 e 🐻 = 8, quanto vale 🐰?", image: null, alternatives: ["2", "3", "4", "5", "6"] },
  { text: "13. Se 🍏 + 🍎 = 14, 🍎 + 🍌 = 12 e 🍌 = 7, quanto vale 🍏?", image: null, alternatives: ["7", "9", "14", "5", "6"] },
  { text: "14. Qual dessas palavras não pertence ao grupo?", image: null, alternatives: ["Telefone", "Televisão", "Rádio", "Ônibus", "Jornal"] },
  { text: "15. Quantos cubos existem na imagem?", image: "https://static.wixstatic.com/media/38961e_329181f3043e4965895f9b461c5148fa~mv2.png", alternatives: ["6", "10", "7", "12", "13"] },
  { text: "16. Qual figura vem a seguir na sequência?", image: "https://static.wixstatic.com/media/38961e_94a500a3cc2645a0abbf50b4cad2e767~mv2.jpg", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "17. Uma criança empilhou cubos de madeira formando essa configuração.Quantos cubos estão nessa imagem?", image: "https://static.wixstatic.com/media/38961e_675cba66584a4813a0c2fde69765678b~mv2.jpg", alternatives: ["6", "11", "8", "9", "13"] },
  { text: "18. Qual direção vem a seguir na sequência: ↗️⬆️↖️⬅️↙️⬇️__?", image: null, alternatives: ["↘️", "➡️", "↖️", "⬅️", "↗️"] },
  { text: "19. Qual dessas palavras não pertence ao grupo?", image: null, alternatives: ["Matéria", "Energia", "Átomo", "Tempo", "Força"] },
  { text: "20. Qual dessas palavras não pertence ao grupo?", image: null, alternatives: ["Alegria", "Tristeza", "Raiva", "Visão", "Medo"] },
  { text: "21. Olho está para óculos assim como ouvido está para...", image: null, alternatives: ["Luvas", "Brincos", "Sapatos", "Aparelho auditivo", "Boné"] },
  { text: "22. Caneta está para escritor assim como bisturi está para...", image: null, alternatives: ["Professor", "Músico", "Cirurgião", "Pintor", "Advogado"] },
  { text: "23. Qual imagem continua a sequência?", image: "https://static.wixstatic.com/media/38961e_4678791f4c3e4e0aa6b0c176cf7bb841~mv2.png", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "24.Qual dos animais abaixo é mais diferente dos demais?", image: "https://static.wixstatic.com/media/38961e_e9a212f1483b4a55a25dadb812b916b5~mv2.jpg", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "25. Qual figura vem a seguir na sequência?", image: "https://static.wixstatic.com/media/38961e_76623a8c608049f0b87f4ac08358e7b4~mv2.png", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "26. Qual objeto se parece menos com os demais?", image: "https://static.wixstatic.com/media/38961e_6e76e988d92240f695ea07c55ff5f961~mv2.jpg", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "27. Qual é a imagem que melhor completa a sequência?", image: "https://static.wixstatic.com/media/38961e_8ad8e621890a42e99bc06fd3e4ef7f59~mv2.png", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "28. Qual é a imagem que melhor completa a sequência?", image: "https://static.wixstatic.com/media/38961e_d81c4aeea1564e709743fa483f3c0ecc~mv2.png", alternatives: ["A", "B", "C", "D", "E"] },
  { text: "29. Quantos triângulos podem ser contados na figura abaixo ?", image: "https://static.wixstatic.com/media/38961e_97b4792bef0b4dda82a6a580d855af0b~mv2.png", alternatives: ["6", "4", "8", "2", "12"] },
  { text: "30. Dois dados idênticos são empilhados verticalmente de forma perfeita, isto é, a face inferior do dado superior encosta exatamente na face superior do dado inferior, de modo que essa face de contato não fica visível. Considerando que um dado isolado possui 6 faces visíveis, quantas faces ficam visíveis no total quando os dois dados são empilhados considerando que esses dados são cubos perfeitos?", image: null, alternatives: ["11", "10", "12", "9", "8"] },
  { text: "31.Temos um pedaço de papel-carbono quadrado com 2 cm de lado sobre uma folha de papel A4. Colocamos a ponta de um compasso no centro do quadrado e colocamos pesos cobrindo todo o quadrado, de modo a pressionar a folha de carbono sobre o papel abaixo e transferir tinta do carbono para o papel . Então giramos até dar uma volta completa (60 minutos no ponteiro dos minutos). Qual figura será desenhada no papel?", image: null, alternatives: ["hexágono", "círculo", "quadrado", "retângulo", "octógono"] },
  { text: "32. Pedro recebe, de aniversário, uma caixa fechada. Ao abri-la, ele encontra quatro caixas menores, e em cada uma dessas há duas caixas adicionais. Qual é o número total de caixas?", image: null, alternatives: ["9", "12", "13", "14", "16"] },
  { text: "33. Bia tem o triplo da idade de Ana, Carol tem a metade da idade de Bia, e Davi tem o dobro da idade de Carol. É certo dizer que Davi tem:", image: null, alternatives: ["O dobro da idade de Ana.", "A metade da idade de Ana.", "O triplo da idade de Ana.", "A mesma idade que Ana.", "A idade de Ana somada com a idade de Bia."] },
  { text: "34. Todos os quadrados são retângulos; nenhum retângulo é um círculo. Logo, é correto afirmar que:", image: null, alternatives: ["Todos os quadrados são círculos.", "Nenhum quadrado é um círculo.", "Alguns quadrados são círculos.", "A relação não pode ser determinada.", "Alguns quadrados podem ser círculos."] },
  { text: "35. Uma figura com o formato de 'Г' é rotacionada 30 minutos no sentido horário. Qual a forma resultante?", image: null, alternatives: ["┐", "┌", "└", "┘", "L"] },
  { text: "36. Olho está para visão assim como ouvido está para:", image: null, alternatives: ["Audição", "Olfato", "Paladar", "Tato", "Memória"] },
  { text: "37. Se A é maior que B e B é maior que C, então A é maior que C. Essa afirmação é:", image: null, alternatives: ["Verdadeira", "Falsa", "Depende dos valores", "Inconclusiva", "Apenas parcialmente verdadeira"] },
  { text: "38.	Se todos os triângulos têm 3 lados e todos os polígonos têm pelo menos 3 lados, com base exclusivamente no que é dito nesse enunciado, então:", image: null, alternatives: [ "Todos os polígonos são triângulos.", "Todos os triângulos são polígonos.", "Nenhum triângulo é polígono.", "Alguns polígonos não são circulos.", "Não se pode concluir nada."] },
  { text: "39. Livro está para ler assim como faca está para:", image: null, alternatives: ["Cozinhar", "Cortar", "Escrever", "Cantar", "Ler"] },
  { text: "40. Considerando que todo liquido do copo menor foi despejado no copo maior, qual das imagens abaixo melhor representa o copo maior depois dessa transferência:", image: "https://static.wixstatic.com/media/38961e_ef7e484dd8184ebb9489eebaa008ac05~mv2.png", alternatives: ["A", "B", "C", "D", "E"] }
];