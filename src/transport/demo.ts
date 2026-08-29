import type {DiscoveredDevice} from '../core/types';
import {decodeFrames, utf8Decode, utf8Encode, concatBytes} from '../protocol/ktm/framing';
import {PIDS, hex2} from '../protocol/obd/pids';
import type {Transport} from './types';

/**
 * Stand-ins for the two radios, so the app can be developed, demoed and tested
 * on a simulator with no bike in the garage. They implement the same
 * `Transport` interface, which means everything above them — the ELM327
 * conversation, the framing, the stores, the screens — runs unmodified.
 */

/** MY RIDE, plus the audio profiles a real dashboard also advertises. */
const DEMO_DASHBOARD_SERVICES = [
  'cc4c1fb3-482e-4389-bdeb-57b7aac889ae',
  '0000111e-0000-1000-8000-00805f9b34fb',
  '0000110b-0000-1000-8000-00805f9b34fb',
];

abstract class BaseDemoTransport implements Transport {
  abstract readonly id: string;
  protected listeners = new Set<(data: Uint8Array) => void>();
  private disconnectListeners = new Set<(reason?: string) => void>();
  private connected = false;
  private currentDevice: DiscoveredDevice | null = null;

  protected abstract get demoDevice(): DiscoveredDevice;

  get isConnected(): boolean {
    return this.connected;
  }

  get device(): DiscoveredDevice | null {
    return this.currentDevice;
  }

  isSupported(): boolean {
    return true;
  }

  async ensureReady(): Promise<void> {}

  async scan(onDevice: (device: DiscoveredDevice) => void): Promise<void> {
    onDevice(this.demoDevice);
  }

  async stopScan(): Promise<void> {}

  async connect(_deviceId: string): Promise<void> {
    this.connected = true;
    this.currentDevice = this.demoDevice;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.currentDevice = null;
  }

  abstract write(data: Uint8Array): Promise<void>;

  onData(listener: (data: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener: (reason?: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  protected emit(text: string): void {
    const bytes = utf8Encode(text);
    this.listeners.forEach(listener => listener(bytes));
  }
}

/** A fake ELM327 wired to a fake bike going for a ride. */
export class DemoObdTransport extends BaseDemoTransport {
  readonly id = 'demo-obd';
  private startedAt = Date.now();

  protected get demoDevice(): DiscoveredDevice {
    return {id: 'demo-obd', name: 'Demo OBD adapter', likelyMatch: true};
  }

  async write(data: Uint8Array): Promise<void> {
    const command = utf8Decode(data).trim().toUpperCase();
    // A real adapter answers after a few tens of milliseconds.
    setTimeout(() => this.emit(this.reply(command)), 25);
  }

  private reply(command: string): string {
    if (command.startsWith('AT')) {
      return command === 'ATZ' ? 'ELM327 v1.5\r\r>' : 'OK\r\r>';
    }
    if (command === '03') {
      return '43010143\r\r>'; // one stored code: P0101
    }
    if (command === '0100') {
      return `4100${supportMask(0x00)}\r\r>`;
    }
    if (command === '0120') {
      return `4120${supportMask(0x20)}\r\r>`;
    }
    if (command === '0140') {
      return `4140${supportMask(0x40)}\r\r>`;
    }
    if (command.startsWith('01') && command.length === 4) {
      const pid = command.slice(2);
      const value = this.sample(pid);
      return value ? `41${pid}${value}\r\r>` : 'NO DATA\r\r>';
    }
    return '?\r\r>';
  }

  /** Encode the current simulated value for `pid`, or null if we do not model it. */
  private sample(pid: string): string | null {
    const ride = simulateRide((Date.now() - this.startedAt) / 1000);
    switch (pid) {
      case '0C':
        return hex4(Math.round(ride.rpm * 4));
      case '0D':
        return hex2(Math.round(ride.speedKph));
      case '11':
        return hex2(Math.round((ride.throttlePct * 255) / 100));
      case '04':
        return hex2(Math.round((ride.loadPct * 255) / 100));
      case '05':
        return hex2(Math.round(ride.coolantC + 40));
      case '0F':
        return hex2(Math.round(ride.intakeC + 40));
      case '5C':
        return hex2(Math.round(ride.oilC + 40));
      case '46':
        return hex2(Math.round(ride.ambientC + 40));
      case '42':
        return hex4(Math.round(ride.volts * 1000));
      case '2F':
        return hex2(Math.round((ride.fuelPct * 255) / 100));
      default:
        return null;
    }
  }
}

/** A dashboard that accepts frames and reports what it was told to draw. */
export class DemoDashboardTransport extends BaseDemoTransport {
  readonly id = 'demo-dashboard';
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private onView?: (payload: string) => void) {
    super();
  }

  protected get demoDevice(): DiscoveredDevice {
    return {
      id: 'demo-dashboard',
      name: 'Demo KTM dashboard',
      likelyMatch: true,
      services: DEMO_DASHBOARD_SERVICES,
    };
  }

  /** A dashboard with MY RIDE activated looks like this over SDP. */
  async discoverServices(): Promise<string[]> {
    return DEMO_DASHBOARD_SERVICES;
  }

  /** Refuse a service this dashboard does not run, as a real one would. */
  async connect(deviceId: string, serviceUuid?: string): Promise<void> {
    if (serviceUuid && !DEMO_DASHBOARD_SERVICES.includes(serviceUuid.toLowerCase())) {
      throw new Error(
        `read failed, socket might closed or timeout, read ret: -1 (${serviceUuid})`,
      );
    }
    await super.connect(deviceId);
  }

  async write(data: Uint8Array): Promise<void> {
    this.buffer = concatBytes(this.buffer, data);
    const {frames, rest} = decodeFrames(this.buffer);
    this.buffer = rest;
    frames.forEach(frame => this.onView?.(frame.payload));
  }
}

interface RideSample {
  rpm: number;
  speedKph: number;
  throttlePct: number;
  loadPct: number;
  coolantC: number;
  intakeC: number;
  oilC: number;
  ambientC: number;
  volts: number;
  fuelPct: number;
}

/**
 * A repeating 90 second lap: pull away, work through the gears, brake for a
 * corner, do it again. Deterministic in `seconds` so tests can assert on it.
 */
export function simulateRide(seconds: number): RideSample {
  const t = seconds % 90;
  const phase = t / 90;
  const speedKph = Math.max(0, 70 + 60 * Math.sin(phase * Math.PI * 2) + 15 * Math.sin(phase * Math.PI * 6));
  const gear = Math.min(6, Math.max(1, Math.floor(speedKph / 28) + 1));
  const ratios = [155, 108, 85, 71, 62, 55];
  const rpm = Math.min(10500, Math.max(1200, speedKph * ratios[gear - 1]));
  const throttlePct = Math.min(100, Math.max(2, 25 + 45 * Math.sin(phase * Math.PI * 2 + 0.4)));

  return {
    rpm,
    speedKph,
    throttlePct,
    loadPct: Math.min(100, throttlePct * 0.9),
    coolantC: 78 + 12 * Math.sin(phase * Math.PI * 2),
    intakeC: 28 + 4 * Math.sin(phase * Math.PI * 4),
    oilC: 88 + 9 * Math.sin(phase * Math.PI * 2 + 1),
    ambientC: 21,
    volts: 13.8 + 0.4 * Math.sin(phase * Math.PI * 8),
    fuelPct: Math.max(6, 82 - (seconds / 60) * 0.6),
  };
}

/** Support mask advertising every PID this app knows about in `base`'s range. */
function supportMask(base: number): string {
  let bits = 0;
  PIDS.forEach(pid => {
    const value = parseInt(pid.pid, 16);
    if (value > base && value <= base + 0x20) {
      bits |= 1 << (31 - (value - base - 1));
    }
  });
  if (base < 0x40) {
    bits |= 1; // bit 32: the next range is supported too
  }
  return (bits >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function hex4(value: number): string {
  const clamped = Math.max(0, Math.min(0xffff, value));
  return hex2(clamped >> 8) + hex2(clamped & 0xff);
}
