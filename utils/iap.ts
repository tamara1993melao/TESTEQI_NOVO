import Constants from 'expo-constants';

let Purchases: any = null;
try {
  Purchases = require('react-native-purchases')?.default || null;
} catch {
  Purchases = null;
}

const IS_EXPO_GO = Constants?.appOwnership === 'expo';

const noop = () => {};
const logStub = (m:string) => console.warn('[IAP][stub]', m);

export function initIAP(apiKey: string) {
  if (IS_EXPO_GO) { logStub('Ignorado (Expo Go)'); return; }
  if (!Purchases || typeof Purchases.configure !== 'function') {
    logStub('Módulo nativo ausente'); return;
  }
  try {
    Purchases.configure({ apiKey });
  } catch (e:any) {
    console.warn('[IAP] init erro', e.message);
  }
}

export function subscribeCustomerInfo(listener: (info:any)=>void) {
  if (!Purchases || typeof Purchases.addCustomerInfoUpdateListener !== 'function') {
    logStub('Listener indisponível'); return noop;
  }
  try {
    const sub = Purchases.addCustomerInfoUpdateListener(listener);
    return () => { try { sub && sub(); } catch {} };
  } catch {
    return noop;
  }
}

// Stubs para evitar ReferenceError
export async function getOfferings() {
  if (!Purchases?.getOfferings) { logStub('getOfferings stub'); return null; }
  try { return await Purchases.getOfferings(); } catch { return null; }
}

export async function purchasePackage(pkg:any) {
  if (!Purchases?.purchasePackage) { logStub('purchasePackage stub'); return null; }
  try { return await Purchases.purchasePackage(pkg); } catch (e) { console.warn('[IAP] purchase erro', e); return null; }
}

export async function restorePurchases() {
  if (!Purchases?.restorePurchases) { logStub('restorePurchases stub'); return null; }
  try { return await Purchases.restorePurchases(); } catch { return null; }
}