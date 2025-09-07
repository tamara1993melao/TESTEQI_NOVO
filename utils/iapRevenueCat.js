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
  Purchases = require('react-native-purchases');
} catch (e) {
  Purchases = null;
}

function getApiKey() {
  const extra = Constants.expoConfig?.extra ?? {};
  const ios = extra.EXPO_PUBLIC_RC_IOS ?? process.env.EXPO_PUBLIC_RC_IOS;
  const android = extra.EXPO_PUBLIC_RC_ANDROID ?? process.env.EXPO_PUBLIC_RC_ANDROID;
  return Platform.OS === 'ios' ? ios : android;
}

export async function initIAP() {
  if (!Purchases) {
    console.warn('[IAP] Módulo nativo indisponível no Expo Go. Ignorando init.');
    return;
  }
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  const apiKey = getApiKey();

  if (!apiKey) {
    console.log('[IAP] API Key ausente, verifique app.json extra.*');
    return;
  }

  await Purchases.configure({ apiKey, appUserID: uid });
  console.log('[IAP] RevenueCat configurado para', uid || 'anon');
}

export async function getHasEntitlement(entId = 'stf') {
  if (!Purchases) return false; // No Expo Go, use Supabase/COMPRAS para gating
  const info = await Purchases.getCustomerInfo();
  return !!info?.entitlements?.active?.[entId];
}

export async function purchaseEntitlement(entId = 'stf') {
  if (!Purchases) {
    throw new Error('IAP indisponível no Expo Go. Use Dev Client ou voucher.');
  }
  const offerings = await Purchases.getOfferings();
  const current = offerings?.current;
  // Tenta encontrar um pacote válido (ex.: lifetime ou primeiro disponível)
  const pkg =
    current?.lifetime ||
    current?.availablePackages?.[0] ||
    offerings?.all?.[entId]?.availablePackages?.[0];

  if (!pkg) throw new Error('Oferta não encontrada');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return !!customerInfo?.entitlements?.active?.[entId];
}

export async function restorePurchases(entId = 'stf') {
  if (!Purchases) {
    console.warn('[IAP] Restore indisponível no Expo Go.');
    return false;
  }
  const { customerInfo } = await Purchases.restorePurchases();
  return !!customerInfo?.entitlements?.active?.[entId];
}

export function onEntitlementsChanged(cb) {
  if (!Purchases) {
    // No Expo Go: retorna um unsubscribe no‑op
    return () => {};
  }
  return Purchases.addCustomerInfoUpdateListener((ci) => {
    const has = !!ci?.entitlements?.active?.[ 'stf' ];
    cb?.(has, ci);
  });
}
