import 'react-native-gesture-handler'; // (1) Deve ser a primeira linha como em App.js
// NOTE: Não importamos ./utils/compatibilityFix pois o bug original (caractere 'z' em Confetti) foi corrigido.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlanoProvider } from './planoContext';
import { PaywallProvider } from './paywallContext';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// Linking: usando Linking do react-native para evitar dependência ausente de expo-linking no TS
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Home from './TELAS/Home';
import Login from './TELAS/Login';
import Cadastro from './TELAS/Cadastro';
import { supabase } from './supabaseClient';
import { Session } from '@supabase/supabase-js';
import Perfil from './TELAS/Perfil';
import Testes from './TELAS/Testes';
import Sobre from './TELAS/Sobre';
import RecordsHub from './TELAS/Records/RecordsHub';
import PaywallModal from './TELAS/PaywallModal';
import STF from './TELAS/STF';
import ClassificacaoQI from './TELAS/ClassificacaoQI';
import Nivel1 from './TELAS/Nivel1';
import Mozart from './TELAS/mozart';
import ThinkFast from './TELAS/thinkfast';
import NoticiasHub from './TELAS/NOTICIAS/NoticiasHub';
import NoticiaDetalhe from './TELAS/NOTICIAS/NoticiaDetalhe';
import DesafioHub from './TELAS/Desafio/DesafioHub';
// Tela adicionada para testes (referência está em App.js)
import ThinkFast90 from './TELAS/thinkfast90';
// Telas adicionais (mantidas em App.js)
import Matrizes from './TELAS/matrizes';
import ProcurarSimbolos from './TELAS/Nivel2/ProcurarSimbolos';
import Hub from './TELAS/Personalidades/Hub';
import Adivinhe from './TELAS/Personalidades/Adivinhe';
import IQ from './TELAS/Personalidades/IQ';
import DesafioDetalhe from './TELAS/Desafio/DesafioDetalhe';
import ThinkFastDesafio from './TELAS/ThinkFastDesafio';
import { initIAP, subscribeCustomerInfo } from './utils/iap';

// (2) navigationRef para navegação fora de componentes (igual App.js)
export const navigationRef = createNavigationContainerRef();

// (3) Estrutura de dois níveis: RootStack (Login/App) + Stack interno (AppStack) como no App.js
const RootStack = createNativeStackNavigator();
const Stack = createNativeStackNavigator();

// Ajuste TS: RN removeu typings oficiais de defaultProps, usando cast para manter comportamento.
// Evita warnings de acessibilidade mudando escala de fonte.
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.allowFontScaling = false;
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.allowFontScaling = false;

// (4) Preload de manifest (Matrizes) — migrado de App.js
async function preloadMatrizesManifest() {
  try {
    const { data } = supabase.storage.from('matrizes').getPublicUrl('manifest.json');
    const manifestUrl = data?.publicUrl;
    if (manifestUrl) {
      const resp = await fetch(manifestUrl);
      if (resp.ok) {
        const json = await resp.json();
        await AsyncStorage.setItem('matrizes:manifest', JSON.stringify(json));
        console.log('[MATRIZES] manifest ok:', Array.isArray(json) ? json.length : 'obj');
      }
    }
  } catch (e: any) {
    console.log('[MATRIZES] preload erro', e?.message || e);
  }
}

// (5) AppStack isolado para as telas autenticadas (igual função AppStack em App.js)
function AppStack({ route }: { route: any }) {
  const startOn = route?.params?.startOn || 'Home';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={startOn}>
      <Stack.Screen name="Home" component={Home} />
      <Stack.Screen name="ClassificacaoQI" component={ClassificacaoQI} />
      <Stack.Screen name="Testes" component={Testes} />
      <Stack.Screen name="Sobre" component={Sobre} />
      <Stack.Screen name="STF" component={STF} />
      <Stack.Screen name="Nivel1" component={Nivel1} />
      <Stack.Screen name="Mozart" component={Mozart} />
      <Stack.Screen name="ThinkFast" component={ThinkFast} />
      <Stack.Screen name="Perfil" component={Perfil} />
      <Stack.Screen name="NoticiasHub" component={NoticiasHub} options={{ headerShown: false }} />
      <Stack.Screen name="NoticiaDetalhe" component={NoticiaDetalhe} options={{ headerShown: false }} />
      <Stack.Screen name="RecordsHub" component={RecordsHub} />
      <Stack.Screen name="DesafioHub" component={DesafioHub} options={{ title: 'Desafios' }} />
      <Stack.Screen name="PerfilPersonalidades" component={Perfil} />
      <Stack.Screen name="QuizPersonalidades" component={Hub} />
      <Stack.Screen name="Adivinhe" component={Adivinhe} />
      <Stack.Screen name="IQ" component={IQ} />
      <Stack.Screen name="Matrizes" component={Matrizes} />
      <Stack.Screen name="Nivel2ProcurarSimbolos" component={ProcurarSimbolos} options={{ headerShown: false }} />
      <Stack.Screen name="DesafioDetalhe" component={DesafioDetalhe} options={{ title: 'Desafio' }} />
      <Stack.Screen name="ThinkFastDesafio" component={ThinkFastDesafio} />
      <Stack.Screen name="ThinkFast90" component={ThinkFast90} />
    </Stack.Navigator>
  );
}

// (6) Deep linking config migrada
// Como estamos usando Linking nativo, definimos manualmente o prefixo (ajuste se tiver scheme custom no app.json)
const prefix = 'myapp://';
const linking = {
  prefixes: [prefix],
  config: {
    screens: {
      login: 'Login'
    }
  }
};

// (7) Handler global de notificações migrado
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Campos clássicos
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    // Campos novos (SDKs recentes) para compatibilidade tipada
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export default function App() {
  console.log('STEP: App iniciando');
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  // (8) Sessão Supabase (igual App.js com logs)
  useEffect(() => {
    console.log('STEP: Auth init');
    let sub: { unsubscribe?: () => void } | undefined;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? null);
        sub = supabase.auth.onAuthStateChange((_event, s) => setSession(s)).data.subscription;
      } catch (e: any) {
        console.log('Erro sessão supabase', e?.message || e);
      } finally {
        setInitializing(false);
      }
    })();
    return () => sub?.unsubscribe?.();
  }, []);

  // (9) Preload matrizes
  useEffect(() => {
    console.log('STEP: Matrizes init');
    preloadMatrizesManifest();
  }, []);

  // (9.1) Inicializa IAP (RevenueCat) após saber a sessão
  useEffect(() => {
    (async () => {
      try {
        await initIAP();
      } catch (e: any) {
        console.log('[IAP] init erro', e?.message || e)
      }
    })();
    const sub = subscribeCustomerInfo(() => {
      // opcional: poderíamos disparar um refresh do EntitlementsContext via evento global
      // deixando leve por enquanto
    })
    return () => {
      try { sub?.remove?.() } catch {}
    }
  }, [session?.user?.id])

  // (10) Notificações (permissões + canal Android)
  useEffect(() => {
    console.log('STEP: Notifications init');
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: 'default',
            vibrationPattern: [200, 100, 200],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
          });
        }
      } catch (e: any) {
        console.log('Notif init erro', e?.message || e);
      }
    })();
  }, []);

  // (11) Push token + listeners (se existirem helpers). Comentado para evitar erro caso arquivos não existam.
  // import { registerPushToken, attachNotificationListeners, detachNotificationListeners } from './notifications';
  // useEffect(() => {
  //   console.log('STEP: Notifications listeners', session ? 'with session' : 'no session');
  //   if (session) {
  //     registerPushToken();
  //     attachNotificationListeners();
  //   } else {
  //     detachNotificationListeners();
  //   }
  // }, [session]);

  if (initializing) {
    console.log('STEP: Renderizando loading');
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f2027' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  console.log('STEP: Renderizando app principal');
  return (
    <SafeAreaProvider>
      <PlanoProvider>
        <PaywallProvider>
          <NavigationContainer linking={linking} ref={navigationRef} fallback={<Text>Carregando...</Text>}>
            {session ? (
              <RootStack.Navigator screenOptions={{ headerShown: false }}>
                <RootStack.Screen name="App" component={AppStack} />
              </RootStack.Navigator>
            ) : (
              <RootStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
                <RootStack.Screen name="Login" component={Login} />
                <RootStack.Screen name="Cadastro" component={Cadastro} />
              </RootStack.Navigator>
            )}
          </NavigationContainer>
          {/* (12) PaywallModal fora das rotas para sobrepor qualquer tela */}
          <PaywallModal />
        </PaywallProvider>
      </PlanoProvider>
    </SafeAreaProvider>
  );
}
