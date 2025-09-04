import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';

export default function Cadastro({ navigation }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [birth, setBirth] = useState(''); // dd/mm/aaaa
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  function toIsoDate(d) {
    // dd/mm/aaaa -> aaaa-mm-dd
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || '').trim());
    if (!m) return null;
    const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900) return null;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  function formatBirthInput(text) {
    // Mantém só dígitos e aplica DD/MM/AAAA
    const digits = (text || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  async function handleSignUp() {
    const emailClean = (email || '').trim().toLowerCase();
    const passClean = (pass || '').trim();
    const nameClean = (name || '').trim();
    const nickClean = (nickname || '').trim();
    const birthClean = (birth || '').trim();

    if (!emailClean || !passClean) return Alert.alert('Atenção', 'Preencha e-mail e senha.');
    if (!isValidEmail(emailClean)) return Alert.alert('Atenção', 'E-mail inválido.');
    if (passClean.length < 6) return Alert.alert('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
    if (!nickClean && !nameClean) return Alert.alert('Atenção', 'Informe um Nome ou Apelido.');
    const isoBirth = birthClean ? toIsoDate(birthClean) : null;
    if (birthClean && !isoBirth) return Alert.alert('Atenção', 'Data de nascimento inválida. Use dd/mm/aaaa.');

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: emailClean,
      password: passClean,
      options: {
        data: {
          full_name: nameClean || null,
          nickname: nickClean || null,
          birth_date: isoBirth || null,
        },
      },
    });

    if (error) {
      setLoading(false);
      return Alert.alert('Erro no cadastro', error.message);
    }

    // Se a confirmação de e-mail estiver ativada, data.user pode vir null
    const user = data?.user;
    if (user) {
      const { error: upErr } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          name: nameClean || null,
          nickname: nickClean || null,
          birth_date: isoBirth || null,
        });
      if (upErr) console.log('[profiles] upsert error:', upErr);
    }

    setLoading(false);
    Alert.alert('Cadastro enviado', 'Verifique seu e-mail para confirmar a conta.');
    if (navigation.canGoBack()) navigation.goBack(); // não navega para 'Login'
  }

  return (
    <LinearGradient colors={['#0f2027', '#203a43', '#2c5364']} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
              <Feather name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Criar conta</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Nome completo</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex.: Maria da Silva"
              placeholderTextColor="#8aa2b1"
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />
            <Text style={styles.label}>Apelido (como quer aparecer nos recordes)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex.: Mari"
              placeholderTextColor="#8aa2b1"
              value={nickname}
              onChangeText={setNickname}
              returnKeyType="next"
            />
            <Text style={styles.label}>Data de nascimento</Text>
            <TextInput
              style={styles.input}
              placeholder="dd/mm/aaaa"
              placeholderTextColor="#8aa2b1"
              keyboardType="numeric"
              value={birth}
              onChangeText={(t) => setBirth(formatBirthInput(t))}
              returnKeyType="next"
              maxLength={10}
            />
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>E-mail</Text>
                <TextInput
                  style={styles.input}
                  placeholder="seu@email.com"
                  placeholderTextColor="#8aa2b1"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>Senha</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, borderWidth: 0, backgroundColor: 'transparent' }]}
                    placeholder="••••••••"
                    placeholderTextColor="#8aa2b1"
                    value={pass}
                    onChangeText={setPass}
                    secureTextEntry={!showPass}
                  />
                  <TouchableOpacity onPress={() => setShowPass(v => !v)}>
                    <Feather name={showPass ? 'eye-off' : 'eye'} size={18} color="#b2c7d3" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.btn} onPress={handleSignUp} activeOpacity={0.9} disabled={loading}>
              {loading ? <ActivityIndicator color="#0a0f12" /> : (<><Feather name="user-plus" size={18} color="#0a0f12" /><Text style={styles.btnTxt}>Criar conta</Text></>)}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 50, marginBottom: 14 },
  back: { padding: 6 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  card: { backgroundColor: 'rgba(8,12,20,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 16, padding: 14 },
  label: { color: '#b2c7d3', fontSize: 13, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#fff' },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: 'row', marginTop: 8 },
  btn: { backgroundColor: '#ffd166', borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
  btnTxt: { color: '#0a0f12', fontSize: 16, fontWeight: '800', marginLeft: 8 },
});