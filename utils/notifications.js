import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const INBOX_KEY = '@inbox_v1';
const UNREAD_KEY = '@inbox_unread_v1';
const SYNC_TS_KEY = '@inbox_sync_ts_v1';
const inboxSubs = new Set();

export function onInboxChange(fn) {
  inboxSubs.add(fn);
  return () => inboxSubs.delete(fn);
}

async function emitInboxChange() {
  inboxSubs.forEach((f) => { try { f(); } catch {} });
}

export async function getInbox() {
  const raw = await AsyncStorage.getItem(INBOX_KEY);
  return raw ? JSON.parse(raw) : [];
}
export async function getUnreadCount() {
  const raw = await AsyncStorage.getItem(UNREAD_KEY);
  return Number(raw || '0');
}
export async function markInboxRead() {
  await AsyncStorage.setItem(UNREAD_KEY, '0');
  await emitInboxChange();
}

// Substituir a função addToInbox existente por esta versão
async function addToInbox(entry) {
  const list = await getInbox();
  if (entry.id && list.some(i => i.id === entry.id)) return; // já temos
  const now = Date.now();
  const item = {
    id: entry.id || String(now),
    ts: entry.ts || now,
    title: entry.title || 'Notificação',
    body: entry.body || '',
    data: entry.data || {}
  };
  list.unshift(item);
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(list.slice(0, 100)));
  const unread = (await getUnreadCount()) + 1;
  await AsyncStorage.setItem(UNREAD_KEY, String(unread));
  await emitInboxChange();
}

// Nova função: sincroniza notificações “sent” do servidor
export async function syncInboxFromServer() {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;

    const { data: rows, error } = await supabase
      .from('notification_queue')
      .select('id,title,body,data,scheduled_at,status,user_id')
      .eq('status','sent')
      .or(`user_id.eq.${uid},user_id.is.null`)
      .order('scheduled_at', { ascending: false })
      .limit(30);

    if (error) { console.log('sync error', error.message); return; }

    // Adiciona em ordem cronológica
    (rows||[])
      .sort((a,b)=> new Date(a.scheduled_at)-new Date(b.scheduled_at))
      .forEach(r => {
        let parsed = r.data;
        if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = {}; } }
        addToInbox && addToInbox({
          id: `queue:${r.id}:sent`,
          title: r.title || 'Notificação',
          body: r.body || '',
          data: parsed,
          ts: new Date(r.scheduled_at).getTime()
        });
      });
  } catch(e) {
    console.log('syncInboxFromServer catch', e?.message||e);
  }
}

// Registra chegada e clique para gravar no inbox local
Notifications.addNotificationReceivedListener((n) => {
  const c = n.request?.content ?? {};
  addToInbox({ id: n.request?.identifier, title: c.title, body: c.body, data: c.data });
});
Notifications.addNotificationResponseReceivedListener((r) => {
  const c = r.notification?.request?.content ?? {};
  addToInbox({ id: r.notification?.request?.identifier, title: c.title, body: c.body, data: c.data });
});

export async function registerForPushNotificationsAsync() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing !== 'granted'
    ? (await Notifications.requestPermissionsAsync()).status
    : existing;
  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Geral', importance: Notifications.AndroidImportance.DEFAULT, showBadge: false,
    });
  }

  const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
  const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData?.data;

  const { data } = await supabase.auth.getUser();
  const user_id = data?.user?.id;
  if (user_id && token) {
    await supabase.from('user_devices').upsert({
      user_id, expo_push_token: token, platform: Platform.OS,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, { onConflict: 'expo_push_token' });
  }
  return token;
}

export function attachNotificationNavigation(navigation) {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const d = resp.notification.request.content.data || {};
    if (d.t === 'article' && d.article_id) navigation.navigate('NoticiaDetalhe', { id: d.article_id });
    else if (d.t === 'record' || d.t === 'leaderboard') navigation.navigate('RecordsHub');
    else if (d.t === 'thinkfast_daily') navigation.navigate('ThinkFastDesafio');
  });
  return sub;
}

export async function enviarPushTeste(opts = {}) {
  const { title = 'Teste do Supabase', body = 'Se chegou, fluxo OK.', data = {}, when = new Date(), userId = null } = opts;
  const { data: auth } = await supabase.auth.getUser();
  const uid = userId ?? auth?.user?.id ?? null;

  const payload = { title, body, data, user_id: uid, scheduled_at: when.toISOString() };
  await supabase.from('notification_queue').insert(payload);
  supabase.functions.invoke('notify').catch(() => {}); // processa a fila agora
}

let queueChannel = null;

function parseData(v) {
  try { return typeof v === 'string' ? JSON.parse(v) : (v ?? {}); }
  catch { return {}; }
}

// Aceita jobs do próprio usuário OU broadcast (user_id NULL)
function shouldDeliver(n, uid) {
  return !n?.user_id || n.user_id === uid;
}

export async function watchQueueToInbox() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;

  if (queueChannel) {
    try { await queueChannel.unsubscribe(); } catch {}
    queueChannel = null;
  }

  queueChannel = supabase
    .channel('queue-inbox')
    // Não usar filter aqui. Filtramos no cliente (shouldDeliver).
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_queue' }, (payload) => {
      const n = payload?.new;
      if (!n || !shouldDeliver(n, uid)) return;
      // feedback imediato (opcional). Comente se quiser só quando "sent".
      addToInbox({
        id: `queue:${n.id}:ins`,
        title: n.title || 'Notificação',
        body: n.body || '',
        data: parseData(n.data),
      });
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_queue' }, (payload) => {
      const n = payload?.new;
      if (!n || !shouldDeliver(n, uid)) return;
      if (n.status === 'sent') {
        addToInbox({
          id: `queue:${n.id}:sent`,
          title: n.title || 'Notificação',
          body: n.body || '',
          data: parseData(n.data),
        });
      }
    })
    .subscribe();
}

export async function unwatchQueueToInbox() {
  if (queueChannel) {
    try { await queueChannel.unsubscribe(); } catch {}
    queueChannel = null;
  }
}

let asked = false;

export async function ensureNotificationSetup() {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    }
    if (!granted) {
      console.log('[Notify] permissão negada');
      return false;
    }
    if (Platform.OS === 'android' && !asked) {
      await Notifications.setNotificationChannelAsync('thinkfast', {
        name: 'ThinkFast',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0,250,250,250],
        lightColor: '#2196F3'
      });
    }
    asked = true;
    return true;
  } catch (e) {
    console.log('[Notify] setup erro', e.message);
    return false;
  }
}

export async function schedulePostGameReminder(minutes=5) {
  try {
    const ok = await ensureNotificationSetup();
    if (!ok) return null;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Novo desafio ThinkFast',
        body: 'Volte e tente superar sua pontuação!',
        sound: 'default',
      },
      trigger: { seconds: minutes * 60 }
    });
    console.log('[Notify] agendada', id);
    return id;
  } catch (e) {
    console.log('[Notify] schedule erro', e.message);
    return null;
  }
}