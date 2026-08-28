/**
 * Shared domain types for the KTM Connect app.
 *
 * The app talks to a motorcycle over two independent links:
 *
 *  - `telemetry`  — a BLE OBD-II adapter plugged into the bike's diagnostic
 *                   port. The bike answers OBD-II requests; we display them.
 *                   Works on Android and iOS.
 *  - `dashboard`  — the KTM MY RIDE RFCOMM link. We push text/turn-by-turn
 *                   frames to the bike's TFT display. Android only, because
 *                   iOS does not expose Bluetooth Classic serial ports to
 *                   non-MFi apps. See docs/KTM-PROTOCOL.md.
 */

export type LinkId = 'telemetry' | 'dashboard';

export type LinkStatus =
  | 'unsupported'
  | 'unavailable'
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

export interface LinkState {
  status: LinkStatus;
  deviceId?: string;
  deviceName?: string;
  /** Human readable detail for the UI: last error, or what we are waiting on. */
  message?: string;
  since?: number;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  /** RSSI in dBm when the transport reports it. */
  rssi?: number;
  /** True when the device name/advertisement looks like the thing we want. */
  likelyMatch: boolean;
}

/**
 * A snapshot of everything we know about the bike right now. Every field is
 * optional: which OBD-II PIDs a given ECU answers varies by model and year.
 */
export interface Telemetry {
  rpm?: number;
  /** Vehicle speed in km/h as reported by the ECU. */
  speedKph?: number;
  coolantTempC?: number;
  intakeTempC?: number;
  oilTempC?: number;
  ambientTempC?: number;
  throttlePct?: number;
  enginePct?: number;
  batteryVolts?: number;
  fuelLevelPct?: number;
  /** Estimated gear, derived from the rpm/speed ratio. */
  gear?: number;
  /** Epoch ms of the most recent successful read. */
  updatedAt?: number;
}

export type TelemetryKey = Exclude<keyof Telemetry, 'updatedAt'>;

export interface DiagnosticCode {
  code: string;
  /** Raw two-byte payload the ECU returned, for reporting upstream. */
  raw: string;
}

export interface TripStats {
  startedAt: number;
  /** Distance in km, integrated from the speed readings. */
  distanceKm: number;
  maxSpeedKph: number;
  maxRpm: number;
  /** Time the engine has been turning over, in ms. */
  movingMs: number;
}
