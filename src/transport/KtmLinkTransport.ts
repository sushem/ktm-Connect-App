import {DeviceEventEmitter, Platform, type EmitterSubscription} from 'react-native';

import NativeKtmLink from '../../specs/NativeKtmLink';
import type {DiscoveredDevice} from '../core/types';
import {fromBase64, toBase64} from '../protocol/ktm/framing';
import {requestBluetoothPermissions} from './permissions';
import {TransportError, type Transport} from './types';

/** The RFCOMM service the MY RIDE dashboard registers. */
export const KTM_SERVICE_UUID = 'cc4c1fb3-482e-4389-bdeb-57b7aac889ae';

/** Bonded-device names that belong to a bike rather than a headset. */
const BIKE_NAME_HINTS = [/ktm/i, /lc8/i, /husqvarna/i, /gasgas/i];

const EVENT_DATA = 'KtmLink:data';
const EVENT_DISCONNECT = 'KtmLink:disconnect';

/**
 * Bluetooth Classic link to the bike's TFT display.
 *
 * There is no scanning here: the dashboard has to be paired through the
 * system's Bluetooth settings first (the bike shows a PIN), and after that it
 * appears in the bonded list. On iOS the native module is absent and every
 * call reports the link as unsupported.
 */
export class KtmLinkTransport implements Transport {
  readonly id = 'ktm-link';

  private connected = false;
  private current: DiscoveredDevice | null = null;
  private dataSub: EmitterSubscription | null = null;
  private disconnectSub: EmitterSubscription | null = null;
  private dataListeners = new Set<(data: Uint8Array) => void>();
  private disconnectListeners = new Set<(reason?: string) => void>();

  get isConnected(): boolean {
    return this.connected;
  }

  get device(): DiscoveredDevice | null {
    return this.current;
  }

  isSupported(): boolean {
    return Platform.OS === 'android' && NativeKtmLink != null;
  }

  async ensureReady(): Promise<void> {
    if (!this.isSupported()) {
      throw new TransportError(
        Platform.OS === 'ios'
          ? 'iOS only lets MFi-licensed apps open a Bluetooth serial port, so the dashboard link is Android-only.'
          : 'The KTM link module is not available in this build.',
      );
    }
    const {granted, missing} = await requestBluetoothPermissions();
    if (!granted) {
      throw new TransportError(`Bluetooth permission denied: ${missing.join(', ')}`);
    }
    const enabled = await NativeKtmLink!.isEnabled();
    if (!enabled) {
      throw new TransportError('Bluetooth is switched off');
    }
  }

  /**
   * "Scanning" for the dashboard means listing bonded devices — pairing happens
   * in the system settings, with the bike showing the PIN on its display.
   */
  async scan(onDevice: (device: DiscoveredDevice) => void): Promise<void> {
    await this.ensureReady();
    const paired = await NativeKtmLink!.getPairedDevices();
    paired.forEach(device =>
      onDevice({
        id: device.id,
        name: device.name,
        likelyMatch: BIKE_NAME_HINTS.some(hint => hint.test(device.name)),
        services: device.uuids,
      }),
    );
  }

  async stopScan(): Promise<void> {
    // Listing bonded devices is a one-shot call; nothing to stop.
  }

  /**
   * Ask the device which services it offers. Answers the question the connect
   * error cannot: is the dashboard running MY RIDE at all?
   */
  async discoverServices(deviceId: string): Promise<string[]> {
    await this.ensureReady();
    try {
      return await NativeKtmLink!.discoverServices(deviceId);
    } catch (error) {
      throw new TransportError(describeError(error), error);
    }
  }

  /**
   * `serviceUuid` defaults to MY RIDE, but any RFCOMM service can be tried —
   * useful on a dashboard that turns out to publish something else.
   */
  async connect(deviceId: string, serviceUuid: string = KTM_SERVICE_UUID): Promise<void> {
    await this.ensureReady();
    await this.disconnect();

    this.dataSub = DeviceEventEmitter.addListener(EVENT_DATA, (base64: string) => {
      const bytes = fromBase64(base64);
      this.dataListeners.forEach(listener => listener(bytes));
    });
    this.disconnectSub = DeviceEventEmitter.addListener(EVENT_DISCONNECT, (reason: string) => {
      this.connected = false;
      this.current = null;
      this.disconnectListeners.forEach(listener => listener(reason));
    });

    try {
      await NativeKtmLink!.connect(deviceId, serviceUuid, false);
    } catch (error) {
      await this.teardownListeners();
      throw new TransportError(describeError(error), error);
    }

    const paired = await NativeKtmLink!.getPairedDevices().catch(() => []);
    const match = paired.find(device => device.id === deviceId);
    this.connected = true;
    this.current = {id: deviceId, name: match?.name ?? deviceId, likelyMatch: true};
  }

  async disconnect(): Promise<void> {
    await this.teardownListeners();
    this.connected = false;
    this.current = null;
    if (this.isSupported()) {
      await NativeKtmLink!.disconnect().catch(() => {});
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new TransportError('Not connected to the dashboard');
    }
    try {
      await NativeKtmLink!.write(toBase64(data));
    } catch (error) {
      throw new TransportError(describeError(error), error);
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

  private async teardownListeners(): Promise<void> {
    this.dataSub?.remove();
    this.dataSub = null;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
  }
}

function describeError(error: unknown): string {
  const code = (error as {code?: string} | null)?.code;
  const message = (error as {message?: string} | null)?.message ?? 'Unknown Bluetooth error';
  switch (code) {
    case 'E_PERMISSION':
      return 'Android needs the Nearby devices permission before it will open the link.';
    case 'E_BLUETOOTH_OFF':
      return 'Bluetooth is switched off.';
    case 'E_CONNECT':
      return `${message} The usual cause is that the dashboard is not offering this service — check the services it advertises below.`;
    default:
      return message;
  }
}
