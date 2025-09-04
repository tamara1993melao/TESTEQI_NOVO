import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';

// Handler global
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

const TOKEN_KEY = 'push:expoToken';

export async function getExpoPushTokenRaw() {
  // Verifica permissão atual
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) {
    perm = await Notifications.requestPermissionsAsync();
  }
  if (!perm.granted) {
    console.warn('[push] Permissão negada');
    return null;
  }

  // (Opcional) incluir projectId se necessário:
  // const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
  // const tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
  const tokenObj = await Notifications.getExpoPushTokenAsync();
  const token = tokenObj.data;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT
    });
  }
  return token;
}

// Registra e salva no Supabase
export async function registerPushToken() {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    const newToken = await getExpoPushTokenRaw();
    if (!newToken) return;

    const cached = await AsyncStorage.getItem(TOKEN_KEY);
    if (cached === newToken) {
      // Já salvo antes; ainda assim garantir presença no servidor uma vez por sessão?
      // return;
    } else {
      await AsyncStorage.setItem(TOKEN_KEY, newToken);
    }

    const { error } = await supabase.from('user_push_tokens').upsert({
      user_id: auth.user.id,
      expo_token: newToken,
      platform: Platform.OS
    });
    if (error) console.log('[push] upsert error', error);
    else console.log('[push] token registrado');
  } catch (e) {
    console.log('[push] register error', e);
  }
}

// Remover token no logout (opcional)
export async function unregisterPushToken() {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('expo_token', token);
  } catch (e) {
    console.log('[push] unregister error', e);
  }
}

// Listeners (opcionais)
let notifSub, responseSub;
export function attachNotificationListeners() {
  if (!notifSub) {
    notifSub = Notifications.addNotificationReceivedListener(n => {
      console.log('[push] recebida', n.request.identifier);
    });
  }
  if (!responseSub) {
    responseSub = Notifications.addNotificationResponseReceivedListener(r => {
      console.log('[push] clicada', r.notification.request.content.data);
    });
  }
}
export function detachNotificationListeners() {
  notifSub?.remove(); notifSub = null;
  responseSub?.remove(); responseSub = null;
}