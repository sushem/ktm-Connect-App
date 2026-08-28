import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Ask for whatever the running Android version needs before we may scan.
 *
 * Android 12 (API 31) split Bluetooth into BLUETOOTH_SCAN/BLUETOOTH_CONNECT.
 * Before that, a BLE scan required location access. iOS asks for Bluetooth
 * itself the first time the manager is used, so there is nothing to do here.
 */
export async function requestBluetoothPermissions(): Promise<{ granted: boolean; missing: string[] }> {
  if (Platform.OS !== 'android') {
    return { granted: true, missing: [] };
  }

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const wanted =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(wanted);
  const missing = wanted.filter(p => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: missing.length === 0, missing: missing.map(shortName) };
}

function shortName(permission: string): string {
  const parts = permission.split('.');
  return parts[parts.length - 1];
}
