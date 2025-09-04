import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  name: '@perfil_nome',
  adivinhe: '@record_adivinhe',
  iq: '@record_iq',
  connections: '@record_connections',
};

export async function getRecords() {
  try {
    const entries = await AsyncStorage.multiGet(Object.values(KEYS));
    const map = Object.fromEntries(entries);
    return {
      name: map[KEYS.name] || '',
      adivinhe: Number(map[KEYS.adivinhe] || 0),
      iq: Number(map[KEYS.iq] || 0),
      connections: Number(map[KEYS.connections] || 0),
    };
  } catch (e) {
    console.error("Failed to get records", e);
    return { name: '', adivinhe: 0, iq: 0, connections: 0 };
  }
}

export async function updateRecord(mode, score) {
  const key = KEYS[mode];
  if (!key || typeof score !== 'number') return;

  try {
    const currentRecord = Number((await AsyncStorage.getItem(key)) || 0);
    if (score > currentRecord) {
      await AsyncStorage.setItem(key, String(score));
    }
  } catch (e) {
    console.error("Failed to update record", e);
  }
}

export async function setName(name) {
  try {
    await AsyncStorage.setItem(KEYS.name, String(name || ''));
  } catch (e) {
    console.error("Failed to set name", e);
  }
}

export async function resetRecords() {
  try {
    await AsyncStorage.multiRemove([KEYS.adivinhe, KEYS.iq, KEYS.connections]);
  } catch (e) {
    console.error("Failed to reset records", e);
  }
}