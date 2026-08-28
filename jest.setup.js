/* eslint-env jest */
/**
 * Stand-ins for the native modules the app talks to. Everything protocol-level
 * is tested against the demo transports instead, so these only have to be
 * inert enough for the screens to render.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(key => Promise.resolve(store.get(key) ?? null)),
      setItem: jest.fn((key, value) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      removeItem: jest.fn(key => {
        store.delete(key);
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store.clear();
        return Promise.resolve();
      }),
    },
  };
});

jest.mock('react-native-ble-plx', () => {
  class BleManager {
    state = jest.fn(() => Promise.resolve('PoweredOn'));
    startDeviceScan = jest.fn();
    stopDeviceScan = jest.fn();
    connectToDevice = jest.fn(() => Promise.reject(new Error('No BLE in tests')));
    onDeviceDisconnected = jest.fn(() => ({remove: jest.fn()}));
    destroy = jest.fn();
  }
  return {
    BleManager,
    State: {PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff', Unauthorized: 'Unauthorized', Unsupported: 'Unsupported'},
  };
});
