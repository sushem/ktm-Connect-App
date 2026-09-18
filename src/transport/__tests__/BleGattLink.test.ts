import {describeScanResult} from '../BleGattLink';
import {MAIN_SERVICE} from '../../protocol/bccu/uuids';

/**
 * The scan used to drop anything that did not advertise the dashboard service
 * or carry a KTM-ish name, which is how a real 390 Adventure ended up invisible.
 */
describe('describeScanResult', () => {
  it('lists a device that advertises nothing at all', () => {
    const device = describeScanResult({id: 'AA:BB', name: null, rssi: -70});

    expect(device.name).toBe('Unnamed device');
    expect(device.likelyMatch).toBe(false);
  });

  it('marks a device that advertises the dashboard service', () => {
    const device = describeScanResult({id: 'AA:BB', serviceUUIDs: [MAIN_SERVICE.toUpperCase()]});

    expect(device.likelyMatch).toBe(true);
    expect(device.services).toEqual([MAIN_SERVICE]);
  });

  it('marks a device by name when the advertisement omits services', () => {
    expect(describeScanResult({id: 'AA:BB', name: 'KTM3237'}).likelyMatch).toBe(true);
    expect(describeScanResult({id: 'AA:BB', name: 'Husqvarna 901'}).likelyMatch).toBe(true);
  });

  it('falls back to the local name when there is no device name', () => {
    expect(describeScanResult({id: 'AA:BB', localName: 'KTM 390'}).name).toBe('KTM 390');
  });

  it('does not mark a headset as the bike', () => {
    expect(describeScanResult({id: 'AA:BB', name: 'realme Buds T300'}).likelyMatch).toBe(false);
  });
});
