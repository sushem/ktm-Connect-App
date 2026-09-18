import {Platform} from 'react-native';
import {ConnectionPriority, type Device, type Subscription} from 'react-native-ble-plx';

import type {DiscoveredDevice} from '../core/types';
import type {GattLink} from '../protocol/bccu/BccuClient';
import {MAIN_SERVICE} from '../protocol/bccu/uuids';
import {fromBase64, toBase64} from '../protocol/ktm/framing';
import {bleManager} from './bleManager';
import {requestBluetoothPermissions} from './permissions';
import {TransportError} from './types';

/** The dashboard advertises under the bike's name. */
const BIKE_NAME_HINTS = [/ktm/i, /husqvarna/i, /gasgas/i, /lc8/i];

/**
 * Turn one advertisement into a listable device.
 *
 * Everything is listed. A dashboard frequently advertises with no name and
 * without declaring its services, so filtering on either is exactly what hides
 * the bike; the marker sorts the likely candidates to the top instead.
 */
export function describeScanResult(found: {
  id: string;
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
  rssi?: number | null;
}): DiscoveredDevice {
  const name = found.name ?? found.localName ?? '';
  const advertises = (found.serviceUUIDs ?? []).some(uuid => uuid.toLowerCase() === MAIN_SERVICE);
  return {
    id: found.id,
    name: name || 'Unnamed device',
    rssi: found.rssi ?? undefined,
    likelyMatch: advertises || BIKE_NAME_HINTS.some(hint => hint.test(name)),
    services: advertises ? [MAIN_SERVICE] : undefined,
  };
}

/**
 * A GATT connection to a Gen-3 dashboard.
 *
 * Unlike the old serial link this is plain BLE, so it works on both platforms
 * — iOS restricts Bluetooth Classic serial ports, not Core Bluetooth.
 */
export class BleGattLink implements GattLink {
  private device: Device | null = null;
  private subscriptions: Subscription[] = [];
  private scanning = false;
  private disconnectSub: Subscription | null = null;

  get isConnected(): boolean {
    return this.device != null;
  }

  get connectedDevice(): DiscoveredDevice | null {
    return this.device
      ? {id: this.device.id, name: this.device.name ?? this.device.id, likelyMatch: true}
      : null;
  }

  async ensureReady(): Promise<void> {
    const {granted, missing} = await requestBluetoothPermissions();
    if (!granted) {
      throw new TransportError(`Bluetooth permission denied: ${missing.join(', ')}`);
    }
    const state = await bleManager().state();
    if (state !== 'PoweredOn') {
      throw new TransportError(`Bluetooth is ${String(state).toLowerCase()}`);
    }
  }

  /**
   * Look for dashboards. Filtering on the service UUID is the reliable way —
   * the dashboard advertises it — with a name check as a fallback for firmware
   * that leaves the service out of the advertisement.
   */
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

      bleManager().startDeviceScan(null, {allowDuplicates: false}, (error, found) => {
        if (error) {
          finish(new TransportError(error.message, error));
          return;
        }
        if (!found || seen.has(found.id)) {
          return;
        }
        seen.add(found.id);
        onDevice(describeScanResult(found));
      });
    });
  }

  async stopScan(): Promise<void> {
    if (this.scanning) {
      this.scanning = false;
      bleManager().stopDeviceScan();
    }
  }

  async connect(deviceId: string, onDisconnect?: (reason?: string) => void): Promise<void> {
    await this.stopScan();
    await this.disconnect();

    let device: Device;
    try {
      device = await bleManager().connectToDevice(deviceId, {
        timeout: 20000,
        // The bike is usually already bonded over Bluetooth Classic for music
        // and calls, and Android can hand back a stale service cache from that
        // — which hides the dashboard service entirely.
        refreshGatt: 'OnConnected',
      });
      // The handshake and the display writes are small, but a larger MTU keeps
      // every frame in a single packet.
      if (Platform.OS === 'android') {
        device = await device.requestMTU(517).catch(() => device);
        // The handshake has a deadline on the bike's side, and a lazy
        // connection interval is enough to miss it.
        await device
          .requestConnectionPriority(ConnectionPriority.High)
          .catch(() => undefined);
      }
      device = await device.discoverAllServicesAndCharacteristics();
    } catch (error) {
      throw new TransportError(`Could not connect to ${deviceId}`, error);
    }

    const services = await device.services();
    if (!services.some(service => service.uuid.toLowerCase() === MAIN_SERVICE)) {
      await device.cancelConnection().catch(() => {});
      throw new TransportError(
        'This device does not offer the Gen-3 dashboard service. Check the ignition is on, and that you picked the bike rather than a headset — and if the bike is an older model, switch the dashboard protocol on the Setup tab.',
      );
    }

    this.device = device;
    if (onDisconnect) {
      this.disconnectSub = bleManager().onDeviceDisconnected(device.id, () => {
        this.device = null;
        onDisconnect('The bike disconnected');
      });
    }
  }

  async disconnect(): Promise<void> {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    const device = this.device;
    this.device = null;
    if (device) {
      await device.cancelConnection().catch(() => {});
    }
  }

  async write(service: string, characteristic: string, value: Uint8Array): Promise<void> {
    const device = this.device;
    if (!device) {
      throw new TransportError('Not connected to the dashboard');
    }
    await device.writeCharacteristicWithResponseForService(
      service,
      characteristic,
      toBase64(value),
    );
  }

  /**
   * `indication` is deliberate. The dashboard's own app subscribes to the auth
   * characteristic with indications, which are acknowledged at the link layer;
   * the default here would be notifications, which are not. A dashboard that
   * expects acknowledgements can treat an unacknowledged peer as gone and drop
   * the link mid-handshake.
   */
  subscribe(
    service: string,
    characteristic: string,
    listener: (value: Uint8Array) => void,
  ): () => void {
    const device = this.device;
    if (!device) {
      throw new TransportError('Not connected to the dashboard');
    }
    const subscription = device.monitorCharacteristicForService(
      service,
      characteristic,
      (error, found) => {
        if (!error && found?.value) {
          listener(fromBase64(found.value));
        }
      },
      undefined,
      'indication',
    );
    this.subscriptions.push(subscription);
    return () => {
      subscription.remove();
      this.subscriptions = this.subscriptions.filter(item => item !== subscription);
    };
  }
}
