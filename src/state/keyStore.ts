import AsyncStorage from '@react-native-async-storage/async-storage';

import type {KeyStore} from '../protocol/bccu/BccuClient';
import {fromHex, toHex} from '../protocol/bccu/crypto';

const PREFIX = 'ktm-connect/bccu-keys/';

/**
 * The session key pool, kept per bike.
 *
 * The dashboard keeps its copy across ignition cycles and later resumes a
 * session by naming a key rather than deriving new ones, so losing ours means
 * every reconnect stalls and the rider is asked to confirm the pairing again.
 */
export const persistentKeyStore: KeyStore = {
  async load(deviceId) {
    try {
      const stored = await AsyncStorage.getItem(PREFIX + deviceId);
      if (!stored) {
        return null;
      }
      const keys = (JSON.parse(stored) as string[]).map(fromHex);
      return keys.length > 0 ? keys : null;
    } catch {
      // A corrupt pool is no worse than none: pairing again will replace it.
      return null;
    }
  },

  async save(deviceId, keys) {
    await AsyncStorage.setItem(PREFIX + deviceId, JSON.stringify(keys.map(toHex)));
  },
};

/** Forget a bike, so the next connection pairs from scratch. */
export async function forgetDashboardKeys(deviceId: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + deviceId);
}
