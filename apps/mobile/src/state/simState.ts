import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStore } from '@diaspay/api-client';

// Instantané versionné de la simulation (transactions, alertes, journal, litiges), persisté sur l’appareil.
const KEY = 'diaspay.simulator.v1';

export const asyncStateStore: StateStore = {
  async load() {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return 'illisible'; // l’API l’ignore et repart du jeu de démonstration
    }
  },
  async save(snapshot) {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  },
  async clear() {
    await AsyncStorage.removeItem(KEY);
  },
};
