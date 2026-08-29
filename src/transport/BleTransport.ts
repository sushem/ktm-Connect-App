import {Device, Subscription, State} from 'react-native-ble-plx';

import type {DiscoveredDevice} from '../core/types';
import {toBase64, fromBase64} from '../protocol/ktm/framing';
import {bleManager, destroyBleManager} from './bleManager';
import {requestBluetoothPermissions} from './permissions';
import {TransportError, type Transport} from './types';

/**
 * Serial-over-BLE. Cheap OBD dongles expose a UART-like pair of
 * characteristics — one you write to, one that notifies — but they do not agree
 * on which UUIDs to use, so we try the well-known profiles and then fall back
 * to whatever the device advertises with the right properties.
 */
interface UartProfile {
  name: string;
  service: string;
  write: string;
  notify: string;
}

const UART_PROFILES: UartProfile[] = [
  // Vgate iCar / Viecar and most "OBDII BLE" clones.
  {name: 'FFF0', service: '0000fff0-0000-1000-8000-00805f9b34fb', write: '0000fff2-0000-1000-8000-00805f9b34fb', notify: '0000fff1-0000-1000-8000-00805f9b34fb'},
  // HM-10 style modules: one characteristic used for both directions.
  {name: 'FFE0', service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb', notify: '0000ffe1-0000-1000-8000-00805f9b34fb'},
  // LeLink and similar.
  {name: '18F0', service: '000018f0-0000-1000-8000-00805f9b34fb', write: '00002af1-0000-1000-8000-00805f9b34fb', notify: '00002af0-0000-1000-8000-00805f9b34fb'},
  // Nordic UART, used by a few newer adapters.
  {name: 'NUS', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'},
];

/** Names that give away an OBD adapter in a crowded scan list. */
const OBD_NAME_HINTS = [/obd/i, /elm/i, /vgate/i, /viecar/i, /icar/i, /veepeak/i, /konnwei/i, /vlink/i];

/** BLE writes are capped by the negotiated MTU; 20 bytes is always safe. */
const WRITE_CHUNK = 20;

export class BleTransport implements Transport {
  readonly id = 'ble';

  private manager = bleManager();
  private connected: Device | null = null;
  private profile: UartProfile | null = null;
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private dataListeners = new Set<(data: Uint8Array) => void>();
  private disconnectListeners = new Set<(reason?: string) => void>();
  private scanning = false;
  private closingOnPurpose = false;
  private current: DiscoveredDevice | null = null;

  get isConnected(): boolean {
    return this.connected != null;
  }

  get device(): DiscoveredDevice | null {
    return this.current;
  }

  isSupported(): boolean {
    return true;
  }

  async ensureReady(): Promise<void> {
    const {granted, missing} = await requestBluetoothPermissions();
    if (!granted) {
      throw new TransportError(`Bluetooth permission denied: ${missing.join(', ')}`);
    }
    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      throw new TransportError(`Bluetooth is ${describeState(state)}`);
    }
  }

  async scan(onDevice: (device: DiscoveredDevice) => void, timeoutMs = 12000): Promise<void> {
    await this.ensureReady();
    await this.stopScan();

    const seen = new Set<string>();
    this.scanning = true;

    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        void this.stopScan();
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => finish(), timeoutMs);

      this.manager.startDeviceScan(null, {allowDuplicates: false}, (error, device) => {
        if (error) {
          finish(new TransportError(error.message, error));
          return;
        }
        if (!device || seen.has(device.id)) {
          return;
        }
        seen.add(device.id);
        const name = device.name ?? device.localName ?? 'Unknown device';
        onDevice({
          id: device.id,
          name,
          rssi: device.rssi ?? undefined,
          likelyMatch: OBD_NAME_HINTS.some(hint => hint.test(name)),
        });
      });
    });
  }

  async stopScan(): Promise<void> {
    if (this.scanning) {
      this.scanning = false;
      this.manager.stopDeviceScan();
    }
  }

  async connect(deviceId: string): Promise<void> {
    await this.stopScan();
    await this.disconnect();
    this.closingOnPurpose = false;

    let device: Device;
    try {
      device = await this.manager.connectToDevice(deviceId, {timeout: 15000});
      device = await device.discoverAllServicesAndCharacteristics();
    } catch (error) {
      throw new TransportError(`Could not connect to ${deviceId}`, error);
    }

    const profile = await this.resolveProfile(device);
    if (!profile) {
      await device.cancelConnection().catch(() => {});
      throw new TransportError(
        'This device does not expose a serial (UART) service. Is it an OBD-II BLE adapter?',
      );
    }

    this.connected = device;
    this.profile = profile;
    this.current = {
      id: device.id,
      name: device.name ?? device.localName ?? deviceId,
      likelyMatch: true,
    };

    this.notifySub = device.monitorCharacteristicForService(
      profile.service,
      profile.notify,
      (error, characteristic) => {
        if (error) {
          if (!this.closingOnPurpose) {
            this.emitDisconnect(error.message);
          }
          return;
        }
        if (characteristic?.value) {
          const bytes = fromBase64(characteristic.value);
          this.dataListeners.forEach(listener => listener(bytes));
        }
      },
    );

    this.disconnectSub = this.manager.onDeviceDisconnected(device.id, (_error, _dev) => {
      if (!this.closingOnPurpose) {
        this.emitDisconnect('Adapter disconnected');
      }
    });
  }

  async disconnect(): Promise<void> {
    this.closingOnPurpose = true;
    this.notifySub?.remove();
    this.notifySub = null;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    const device = this.connected;
    this.connected = null;
    this.profile = null;
    this.current = null;
    if (device) {
      await device.cancelConnection().catch(() => {});
    }
  }

  async write(data: Uint8Array): Promise<void> {
    const device = this.connected;
    const profile = this.profile;
    if (!device || !profile) {
      throw new TransportError('Not connected');
    }
    for (let offset = 0; offset < data.length; offset += WRITE_CHUNK) {
      const chunk = data.subarray(offset, offset + WRITE_CHUNK);
      await device.writeCharacteristicWithoutResponseForService(
        profile.service,
        profile.write,
        toBase64(chunk),
      );
    }
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onDisconnect(listener: (reason?: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Release the native manager. Only call this when tearing the app down. */
  destroy(): void {
    destroyBleManager();
  }

  private emitDisconnect(reason?: string): void {
    this.connected = null;
    this.profile = null;
    this.current = null;
    this.disconnectListeners.forEach(listener => listener(reason));
  }

  private async resolveProfile(device: Device): Promise<UartProfile | null> {
    const services = await device.services();
    const serviceIds = new Set(services.map(service => service.uuid.toLowerCase()));

    for (const profile of UART_PROFILES) {
      if (serviceIds.has(profile.service)) {
        return profile;
      }
    }

    // Nothing known matched. Take the first service that has both a writable
    // and a notifying characteristic — that is a serial port by any other name.
    for (const service of services) {
      const characteristics = await device.characteristicsForService(service.uuid);
      const writable = characteristics.find(c => c.isWritableWithoutResponse || c.isWritableWithResponse);
      const notifying = characteristics.find(c => c.isNotifiable || c.isIndicatable);
      if (writable && notifying) {
        return {
          name: `auto:${service.uuid.slice(4, 8)}`,
          service: service.uuid,
          write: writable.uuid,
          notify: notifying.uuid,
        };
      }
    }
    return null;
  }
}

function describeState(state: State): string {
  switch (state) {
    case State.PoweredOff:
      return 'turned off';
    case State.Unauthorized:
      return 'not permitted for this app';
    case State.Unsupported:
      return 'not supported on this device';
    default:
      return String(state).toLowerCase();
  }
}
