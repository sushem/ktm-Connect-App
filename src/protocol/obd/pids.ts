/**
 * OBD-II service 01 parameters we poll, and how to turn the ECU's bytes into
 * numbers. Only a subset of these is answered by any given KTM ECU — the poller
 * probes support once per session and then only asks for what the bike offers.
 */

import type { TelemetryKey } from '../../core/types';

export interface PidDefinition {
  /** Two hex digits, e.g. '0C' for engine RPM. */
  pid: string;
  /** Where the decoded value lands in the telemetry snapshot. */
  key: TelemetryKey;
  label: string;
  unit: string;
  /** Bytes expected in the reply, after the `41 <pid>` echo. */
  bytes: number;
  decode: (data: number[]) => number;
  /** Poll priority: 'fast' values drive the gauges, 'slow' ones the tiles. */
  rate: 'fast' | 'slow';
}

export const PIDS: PidDefinition[] = [
  {
    pid: '0C',
    key: 'rpm',
    label: 'Engine speed',
    unit: 'rpm',
    bytes: 2,
    rate: 'fast',
    decode: ([a, b]) => (a * 256 + b) / 4,
  },
  {
    pid: '0D',
    key: 'speedKph',
    label: 'Vehicle speed',
    unit: 'km/h',
    bytes: 1,
    rate: 'fast',
    decode: ([a]) => a,
  },
  {
    pid: '11',
    key: 'throttlePct',
    label: 'Throttle position',
    unit: '%',
    bytes: 1,
    rate: 'fast',
    decode: ([a]) => (a * 100) / 255,
  },
  {
    pid: '04',
    key: 'enginePct',
    label: 'Engine load',
    unit: '%',
    bytes: 1,
    rate: 'fast',
    decode: ([a]) => (a * 100) / 255,
  },
  {
    pid: '05',
    key: 'coolantTempC',
    label: 'Coolant',
    unit: '°C',
    bytes: 1,
    rate: 'slow',
    decode: ([a]) => a - 40,
  },
  {
    pid: '0F',
    key: 'intakeTempC',
    label: 'Intake air',
    unit: '°C',
    bytes: 1,
    rate: 'slow',
    decode: ([a]) => a - 40,
  },
  {
    pid: '5C',
    key: 'oilTempC',
    label: 'Engine oil',
    unit: '°C',
    bytes: 1,
    rate: 'slow',
    decode: ([a]) => a - 40,
  },
  {
    pid: '46',
    key: 'ambientTempC',
    label: 'Ambient air',
    unit: '°C',
    bytes: 1,
    rate: 'slow',
    decode: ([a]) => a - 40,
  },
  {
    pid: '42',
    key: 'batteryVolts',
    label: 'Battery',
    unit: 'V',
    bytes: 2,
    rate: 'slow',
    decode: ([a, b]) => (a * 256 + b) / 1000,
  },
  {
    pid: '2F',
    key: 'fuelLevelPct',
    label: 'Fuel level',
    unit: '%',
    bytes: 1,
    rate: 'slow',
    decode: ([a]) => (a * 100) / 255,
  },
];

export const PID_BY_CODE: Record<string, PidDefinition> = PIDS.reduce(
  (acc, pid) => {
    acc[pid.pid] = pid;
    return acc;
  },
  {} as Record<string, PidDefinition>,
);

/**
 * Decode the bitmask returned by the support PIDs (0100, 0120, 0140). Each
 * reply covers the next 32 PIDs, MSB first, and tells us which ones the ECU
 * will answer.
 */
export function decodeSupportMask(basePid: number, data: number[]): string[] {
  const supported: string[] = [];
  const bits = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
  for (let i = 0; i < 32; i++) {
    if ((bits >>> (31 - i)) & 1) {
      supported.push(hex2(basePid + i + 1));
    }
  }
  return supported;
}

export function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}
