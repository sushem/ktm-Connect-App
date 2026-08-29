import {create} from 'zustand';

import type {
  DiagnosticCode,
  DiscoveredDevice,
  LinkId,
  LinkState,
  Telemetry,
  TripStats,
} from '../core/types';
import type {DashboardView} from '../protocol/ktm/messages';
import {restoreView} from '../protocol/ktm/messages';

const MAX_LOG_LINES = 200;
const MAX_RECENT_MESSAGES = 8;

export interface LogLine {
  at: number;
  source: LinkId | 'app';
  text: string;
}

interface SessionState {
  links: Record<LinkId, LinkState>;
  devices: Record<LinkId, DiscoveredDevice[]>;
  telemetry: Telemetry;
  trip: TripStats | null;
  codes: DiagnosticCode[];
  dashboardView: DashboardView;
  /** Messages the rider has put on the bike's screen, newest first. */
  sentMessages: string[];
  log: LogLine[];

  setLink: (link: LinkId, state: Partial<LinkState>) => void;
  setDevices: (link: LinkId, devices: DiscoveredDevice[]) => void;
  addDevice: (link: LinkId, device: DiscoveredDevice) => void;
  setDeviceServices: (link: LinkId, deviceId: string, services: string[]) => void;
  mergeTelemetry: (patch: Telemetry) => void;
  resetTelemetry: () => void;
  setCodes: (codes: DiagnosticCode[]) => void;
  setDashboardView: (view: DashboardView) => void;
  rememberMessage: (text: string) => void;
  appendLog: (source: LinkId | 'app', text: string) => void;
  clearLog: () => void;
  startTrip: () => void;
  endTrip: () => void;
}

const idleLink = (status: LinkState['status'] = 'idle'): LinkState => ({status});

export const useSession = create<SessionState>((set, get) => ({
  links: {telemetry: idleLink(), dashboard: idleLink()},
  devices: {telemetry: [], dashboard: []},
  telemetry: {},
  trip: null,
  codes: [],
  dashboardView: restoreView(),
  sentMessages: [],
  log: [],

  setLink: (link, state) =>
    set(current => ({
      links: {...current.links, [link]: {...current.links[link], ...state, since: Date.now()}},
    })),

  setDevices: (link, devices) => set(current => ({devices: {...current.devices, [link]: devices}})),

  addDevice: (link, device) =>
    set(current => {
      const existing = current.devices[link];
      if (existing.some(d => d.id === device.id)) {
        return current;
      }
      // Likely matches first, then strongest signal.
      const next = [...existing, device].sort((a, b) => {
        if (a.likelyMatch !== b.likelyMatch) {
          return a.likelyMatch ? -1 : 1;
        }
        return (b.rssi ?? -999) - (a.rssi ?? -999);
      });
      return {devices: {...current.devices, [link]: next}};
    }),

  setDeviceServices: (link, deviceId, services) =>
    set(current => ({
      devices: {
        ...current.devices,
        [link]: current.devices[link].map(device =>
          device.id === deviceId ? {...device, services} : device,
        ),
      },
    })),

  mergeTelemetry: patch =>
    set(current => {
      const telemetry = {...current.telemetry, ...patch};
      return {telemetry, trip: advanceTrip(current.trip, current.telemetry, telemetry)};
    }),

  resetTelemetry: () => set({telemetry: {}}),

  setCodes: codes => set({codes}),

  rememberMessage: text =>
    set(current => ({
      // Re-sending an old message moves it back to the top rather than
      // filling the list with duplicates.
      sentMessages: [text, ...current.sentMessages.filter(m => m !== text)].slice(
        0,
        MAX_RECENT_MESSAGES,
      ),
    })),

  setDashboardView: view => set({dashboardView: view}),

  appendLog: (source, text) =>
    set(current => ({
      log: [...current.log, {at: Date.now(), source, text}].slice(-MAX_LOG_LINES),
    })),

  clearLog: () => set({log: []}),

  startTrip: () =>
    set({
      trip: {startedAt: Date.now(), distanceKm: 0, maxSpeedKph: 0, maxRpm: 0, movingMs: 0},
      telemetry: get().telemetry,
    }),

  endTrip: () => set({trip: null}),
}));

/**
 * Integrate the trip counters. The gap between two telemetry snapshots is short
 * enough that treating the speed as constant across it is accurate to well
 * within what the ECU reports in the first place.
 */
function advanceTrip(trip: TripStats | null, previous: Telemetry, next: Telemetry): TripStats | null {
  if (!trip || next.updatedAt == null) {
    return trip;
  }
  const elapsedMs = previous.updatedAt ? next.updatedAt - previous.updatedAt : 0;
  const speedKph = next.speedKph ?? previous.speedKph ?? 0;
  const moving = speedKph > 1 && elapsedMs > 0 && elapsedMs < 5000;

  return {
    ...trip,
    distanceKm: trip.distanceKm + (moving ? (speedKph * elapsedMs) / 3_600_000 : 0),
    maxSpeedKph: Math.max(trip.maxSpeedKph, next.speedKph ?? 0),
    maxRpm: Math.max(trip.maxRpm, next.rpm ?? 0),
    movingMs: trip.movingMs + (moving ? elapsedMs : 0),
  };
}
