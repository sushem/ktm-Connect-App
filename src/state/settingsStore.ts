import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';

import {BIKE_PROFILES, DEFAULT_PROFILE, type BikeProfile} from '../utils/gear';
import type {UnitSystem} from '../utils/units';

const STORAGE_KEY = 'ktm-connect/settings/v1';

export interface Settings {
  units: UnitSystem;
  bikeProfileId: string;
  /** Run against the built-in simulator instead of real hardware. */
  demoMode: boolean;
  /** Gap between OBD poll cycles, in ms. Lower is snappier but noisier. */
  pollIntervalMs: number;
  lastObdDeviceId?: string;
  lastDashboardDeviceId?: string;
  /** Mirror speed and gear onto the bike's display while riding. */
  mirrorTelemetryToDashboard: boolean;
}

interface SettingsState extends Settings {
  hydrated: boolean;
  update: (patch: Partial<Settings>) => void;
  hydrate: () => Promise<void>;
  profile: () => BikeProfile;
}

const DEFAULTS: Settings = {
  units: 'metric',
  bikeProfileId: DEFAULT_PROFILE.id,
  demoMode: false,
  pollIntervalMs: 120,
  mirrorTelemetryToDashboard: false,
};

/** Only the settings themselves are written to disk, never the actions. */
function persistable(state: SettingsState): Settings {
  return {
    units: state.units,
    bikeProfileId: state.bikeProfileId,
    demoMode: state.demoMode,
    pollIntervalMs: state.pollIntervalMs,
    lastObdDeviceId: state.lastObdDeviceId,
    lastDashboardDeviceId: state.lastDashboardDeviceId,
    mirrorTelemetryToDashboard: state.mirrorTelemetryToDashboard,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  update: patch => {
    set(patch);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(get())));
  },

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({...DEFAULTS, ...(JSON.parse(stored) as Partial<Settings>)});
      }
    } catch {
      // A corrupt settings blob should never stop the app from starting.
    } finally {
      set({hydrated: true});
    }
  },

  profile: () => BIKE_PROFILES.find(p => p.id === get().bikeProfileId) ?? DEFAULT_PROFILE,
}));
