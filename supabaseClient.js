import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Esta estrutura garante que as chaves sejam lidas em TODOS os ambientes:
// 1. Build de Produção/Preview (EAS): Lê de process.env.EXPO_PUBLIC_*
// 2. Desenvolvimento (Expo Go/Simulador): Usa como fallback a seção "extra" do app.json

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? Constants.expoConfig?.extra?.supabaseUrl;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? Constants.expoConfig?.extra?.supabaseAnonKey;

console.log(`[Supabase Init] URL: ${supabaseUrl}, Key Length: ${supabaseAnonKey?.length}`);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("ERRO CRÍTICO: URL ou Chave do Supabase não encontrada. Verifique a seção 'extra' do app.json para desenvolvimento e o 'env' do eas.json para builds.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Helpers: obtém nome do usuário logado (metadata.full_name/name/username ou email)
export async function getLoginUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export async function getLoginUserName() {
  const u = await getLoginUser();
  if (!u) return null;
  const m = u.user_metadata || {};
    return m.nickname || m.preferred_name || m.full_name || m.name || u.email || null;
}

// Garante um nome (cai no fallback se não houver login)
export async function requireUserName(fallback = 'Convidado') {
  return (await getLoginUserName()) || fallback;
}