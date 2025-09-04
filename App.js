import 'react-native-gesture-handler'; // DEVE SER PRIMEIRA LINHA
import './utils/compatibilityFix'; // Importar logo após gesture-handler
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { registerPushToken, attachNotificationListeners, detachNotificationListeners } from './notifications';

// Telas básicas (funcionais)
import Home from './TELAS/Home';
import Login from './TELAS/Login';
import Cadastro from './TELAS/Cadastro';
import ClassificacaoQI from './TELAS/ClassificacaoQI';
import Testes from './TELAS/Testes';
import Sobre from './TELAS/Sobre';
import STF from './TELAS/STF';
import Nivel1 from './TELAS/Nivel1';
import Mozart from './TELAS/mozart';
import ThinkFast from './TELAS/thinkfast';
import Perfil from './TELAS/Perfil';
import NoticiasHub from './TELAS/NOTICIAS/NoticiasHub';
import NoticiaDetalhe from './TELAS/NOTICIAS/NoticiaDetalhe';

// Providers
import { PlanoProvider } from './planoContext';
import { PaywallProvider } from './paywallContext';
import PaywallModal from './TELAS/PaywallModal';

// TELAS COMENTADAS - problemas com propriedade 'z' em Hermes
import ProcurarSimbolos from './TELAS/Nivel2/ProcurarSimbolos'; 
import ThinkFast90 from './TELAS/thinkfast90';
import Matrizes from './TELAS/matrizes';
import Hub from './TELAS/Personalidades/Hub';
import Adivinhe from './TELAS/Personalidades/Adivinhe';
import IQ from './TELAS/Personalidades/IQ';
import Connections from './TELAS/Personalidades/Connections';
import RecordsHub from './TELAS/Records/RecordsHub';
import DesafioHub from './TELAS/Desafio/DesafioHub';
import DesafioDetalhe from './TELAS/Desafio/DesafioDetalhe';
import ThinkFastDesafio from './TELAS/ThinkFastDesafio';


export const navigationRef = createNavigationContainerRef();

const RootStack = createNativeStackNavigator();
const Stack = createNativeStackNavigator();

// Função pré-carregamento matrizes
async function preloadMatrizesManifest() {
  try {
    const { data } = supabase.storage.from('matrizes').getPublicUrl('manifest.json');
    const manifestUrl = data?.publicUrl;
    if (manifestUrl) {
      const resp = await fetch(manifestUrl);
      if (resp.ok) {
        const json = await resp.json();
        await AsyncStorage.setItem('matrizes:manifest', JSON.stringify(json));
        console.log('[MATRIZES] manifest ok:', json.length);
      }
    }
  } catch (e) {
    console.log('[MATRIZES] preload erro', e?.message || e);
  }
}

function AppStack({ route }) {
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
      <Stack.Screen name="Connections" component={Connections} />
      <Stack.Screen name="Matrizes" component={Matrizes} />
      <Stack.Screen name="Nivel2ProcurarSimbolos" component={ProcurarSimbolos} options={{ headerShown: false }} />
      <Stack.Screen name="DesafioDetalhe" component={DesafioDetalhe} options={{ title: 'Desafio' }} />
      <Stack.Screen name="ThinkFastDesafio" component={ThinkFastDesafio} />
      <Stack.Screen name="ThinkFast90" component={ThinkFast90} />

      {/* TELAS COMENTADAS - problemas com propriedade 'z'
      <Stack.Screen name="ThinkFast90" component={ThinkFast90} />
      <Stack.Screen name="ThinkFastDesafio" component={ThinkFastDesafio} />
      */}
    </Stack.Navigator>
  );
}

const prefix = Linking.createURL('/');
const linking = {
  prefixes: [prefix],
  config: {
    screens: {
      login: 'Login'
    }
  }
};

// Handler global notificações
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

export default function App() {
  console.log('STEP: App iniciando');
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState(null);

  // Sessão Supabase
  useEffect(() => {
    console.log('STEP: Auth init');
    let sub;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? null);
        sub = supabase.auth.onAuthStateChange((_event, s) => setSession(s)).data.subscription;
      } catch (e) {
        console.log('Erro sessão supabase', e.message);
      } finally {
        setInitializing(false);
      }
    })();
    return () => sub?.unsubscribe?.();
  }, []);

  // Pré-carregar manifest matrizes
  useEffect(() => {
    console.log('STEP: Matrizes init');
    preloadMatrizesManifest();
  }, []);

  // Notificações (permissões + canal)
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
      } catch (e) {
        console.log('Notif init erro', e.message);
      }
    })();
  }, []);

  // Push token + listeners
  useEffect(() => {
    console.log('STEP: Notifications listeners', session ? 'with session' : 'no session');
    if (session) {
      registerPushToken();
      attachNotificationListeners();
    } else {
      detachNotificationListeners();
    }
  }, [session]);

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
          <PaywallModal />
        </PaywallProvider>
      </PlanoProvider>
    </SafeAreaProvider>
  );
}

// Font scaling off
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;