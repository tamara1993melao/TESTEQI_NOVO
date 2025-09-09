// Onde criar: utils/iapRevenueCat.js
// Funções utilitárias para integrar RevenueCat no app (Expo/React Native)
// Preencha as chaves em app.json (extra) e use initIAP() no boot do app.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabaseClient';

// Import seguro: em Expo Go o módulo nativo não existe.
let Purchases = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-purchases');
  // Algumas versões exportam default, outras objeto direto
  Purchases = mod?.default || mod || null;
} catch (e) {
  Purchases = null;
}

const IS_EXPO_GO = Constants?.appOwnership === 'expo';

function hasFn(obj, name) {
  return !!(obj && typeof obj[name] === 'function');
}

function getApiKey() {
  const extra = Constants.expoConfig?.extra ?? {};
  const ios = extra.EXPO_PUBLIC_RC_IOS ?? process.env.EXPO_PUBLIC_RC_IOS;
  const android = extra.EXPO_PUBLIC_RC_ANDROID ?? process.env.EXPO_PUBLIC_RC_ANDROID;
  return Platform.OS === 'ios' ? ios : android;
}

export async function initIAP() {
  if (IS_EXPO_GO) {
    console.warn('[IAP] Ignorado (Expo Go).');
    return;
  }
  if (!Purchases || !hasFn(Purchases, 'configure')) {
    console.warn('[IAP] Módulo nativo indisponível.');
    return;
  }
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log('[IAP] API Key ausente, verifique app.json extra.*');
      return;
    }
    await Purchases.configure({ apiKey, appUserID: uid });
    console.log('[IAP] RevenueCat configurado para', uid || 'anon');
  } catch (e) {
    console.warn('[IAP] init erro', e?.message || e);
  }
}

export async function getHasEntitlement(entId = 'stf') {
  if (!Purchases || !hasFn(Purchases, 'getCustomerInfo')) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info?.entitlements?.active?.[entId];
  } catch {
    return false;
  }
}

export async function purchaseEntitlement(entId = 'stf') {
  if (!Purchases || !hasFn(Purchases, 'getOfferings') || !hasFn(Purchases, 'purchasePackage')) {
    throw new Error('IAP indisponível (sem módulo nativo ou Expo Go).');
  }
  const offerings = await Purchases.getOfferings();
  const current = offerings?.current;
  const pkg =
    current?.lifetime ||
    current?.availablePackages?.[0] ||
    offerings?.all?.[entId]?.availablePackages?.[0];
  if (!pkg) throw new Error('Oferta não encontrada');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return !!customerInfo?.entitlements?.active?.[entId];
}

export async function restorePurchases(entId = 'stf') {
  if (!Purchases || !hasFn(Purchases, 'restorePurchases')) {
    console.warn('[IAP] Restore indisponível (sem módulo).');
    return false;
  }
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return !!customerInfo?.entitlements?.active?.[entId];
  } catch {
    return false;
  }
}

export function onEntitlementsChanged(cb) {
  if (!Purchases || !hasFn(Purchases, 'addCustomerInfoUpdateListener')) {
    return () => {};
  }
  try {
    return Purchases.addCustomerInfoUpdateListener((ci) => {
      const has = !!ci?.entitlements?.active?.['stf'];
      cb?.(has, ci);
    });
  } catch {
    return () => {};
  }
}
