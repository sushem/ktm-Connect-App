import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Native RFCOMM link to a KTM dashboard.
 *
 * `react-native-bluetooth-classic` and friends hardcode the Serial Port
 * Profile UUID, and the MY RIDE service is registered under a vendor UUID, so
 * the socket has to be opened here. Android only — iOS reserves Bluetooth
 * Classic serial ports for MFi-licensed accessories, and this module is simply
 * absent there.
 */

export type PairedDevice = {
  id: string;
  name: string;
  bonded: boolean;
};

export interface Spec extends TurboModule {
  /** True on platforms where an RFCOMM socket can be opened at all. */
  isSupported(): Promise<boolean>;
  /** True when the Bluetooth adapter exists and is switched on. */
  isEnabled(): Promise<boolean>;
  /** Devices already paired with the phone. Discovery is not needed: the bike must be bonded. */
  getPairedDevices(): Promise<PairedDevice[]>;
  /**
   * Open an RFCOMM socket to `address` on `uuid`. `secure` picks between
   * createRfcommSocketToServiceRecord and its insecure counterpart; the
   * dashboard wants the insecure one.
   */
  connect(address: string, uuid: string, secure: boolean): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  /** Write raw bytes, base64 encoded. */
  write(base64: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('KtmLink');
