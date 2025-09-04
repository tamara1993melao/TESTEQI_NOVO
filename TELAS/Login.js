import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';

export default function Login() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Atenção', 'Preencha email e senha.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert('Erro no Login', error.message);
      return;
    }
    // Não navegue aqui. O App.js vai renderizar o AppStack quando a sessão existir.
  }

  async function handleForgot() {
    if (!email) {
      Alert.alert('Atenção', 'Informe seu e-mail para recuperar a senha.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return Alert.alert('Erro', error.message);
    Alert.alert('Recuperação enviada', 'Confira seu e-mail para redefinir a senha.');
  }

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    // sem else: evita navegar para rotas que não existem neste stack
  };

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[styles.topBar, { paddingTop: insets.top + 20 }]}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} accessibilityLabel="Voltar">
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <LinearGradient colors={['#ffd166', '#00d3aa']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoGradient}>
            <View style={styles.logoInner}>
              <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="contain" />
            </View>
          </LinearGradient>
          <Text style={styles.appTitle}>Sigma Society</Text>
          <Text style={styles.appSubtitle}>Entre para salvar seus recordes</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inputRow}>
            <Feather name="mail" size={18} color="#b2c7d3" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Seu e-mail"
              placeholderTextColor="#8aa2b1"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />
          </View>

          <View style={styles.inputRow}>
            <Feather name="lock" size={18} color="#b2c7d3" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Senha"
              placeholderTextColor="#8aa2b1"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name={showPass ? 'eye-off' : 'eye'} size={18} color="#b2c7d3" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} activeOpacity={0.9} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#0a0f12" />
            ) : (
              <>
                <Feather name="log-in" size={18} color="#0a0f12" />
                <Text style={styles.primaryBtnTxt}>Entrar</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.linksRow}>
            <TouchableOpacity onPress={handleForgot}>
              <Text style={styles.linkText}>Esqueci minha senha</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Cadastro')}>
              <Text style={styles.linkText}>Criar conta</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.chipsRow}>
            <View style={styles.chip}>
              <Feather name="shield" size={12} color="#fff" />
              <Text style={styles.chipTxt}>Seguro</Text>
            </View>
            <View style={styles.chip}>
              <Feather name="award" size={12} color="#ffd166" />
              <Text style={styles.chipTxt}>Recordes salvos</Text>
            </View>
            <View style={styles.chip}>
              <Feather name="users" size={12} color="#9ad8ff" />
              <Text style={styles.chipTxt}>Torneios</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 65, paddingHorizontal: 20, paddingBottom: 80, justifyContent: 'center' },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff20', borderWidth: 1, borderColor: '#ffffff30' },
  header: { alignItems: 'center', marginTop: 6, marginBottom: 18 },
  logoGradient: { borderRadius: 999, padding: 3, shadowColor: '#00d3aa', shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 },
  logoInner: { backgroundColor: '#0f2027', borderRadius: 999, padding: 12, borderWidth: 1, borderColor: '#ffffff22' },
  logo: { width: 72, height: 72 },
  appTitle: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: 0.3, marginTop: 10 },
  appSubtitle: { color: '#b2c7d3', fontSize: 13, marginTop: 4 },
  card: { marginHorizontal: 20, padding: 18, borderRadius: 16, backgroundColor: 'rgba(8,12,20,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 2 },
  primaryBtn: { backgroundColor: '#ffd166', borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 6 },
  primaryBtnTxt: { color: '#0a0f12', fontSize: 16, fontWeight: '800', marginLeft: 8 },
  linksRow: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
  linkText: { color: '#9ad8ff', fontWeight: '700' },
  footer: { alignItems: 'center', marginTop: 22 },
  chipsRow: { flexDirection: 'row', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff20', borderColor: '#ffffff30', borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, gap: 6 },
  chipTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
});