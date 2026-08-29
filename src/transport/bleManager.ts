import {BleManager} from 'react-native-ble-plx';

/**
 * One BLE manager for the whole app.
 *
 * Both links can be BLE now — the OBD adapter and a Gen-3 dashboard — and two
 * managers would each hold their own connection state and scan callbacks,
 * which the platform does not expect. Created on first use so the native
 * module is only touched once the user asks for Bluetooth.
 */
let manager: BleManager | null = null;

export function bleManager(): BleManager {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

/** Only for tearing the app down, or resetting between tests. */
export function destroyBleManager(): void {
  manager?.destroy();
  manager = null;
}
