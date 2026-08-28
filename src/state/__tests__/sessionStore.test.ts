import {useSession} from '../sessionStore';

const reset = () =>
  useSession.setState({
    telemetry: {},
    trip: null,
    devices: {telemetry: [], dashboard: []},
    log: [],
  });

describe('session store', () => {
  beforeEach(reset);

  it('integrates distance from the speed readings', () => {
    const store = useSession.getState();
    store.startTrip();
    // 60 km/h for four seconds is 67 m.
    store.mergeTelemetry({speedKph: 60, updatedAt: 1_000_000});
    store.mergeTelemetry({speedKph: 60, updatedAt: 1_004_000});

    const trip = useSession.getState().trip!;
    expect(trip.distanceKm).toBeCloseTo(0.0667, 3);
    expect(trip.movingMs).toBe(4_000);
  });

  it('does not count a gap while the app was asleep as distance', () => {
    const store = useSession.getState();
    store.startTrip();
    store.mergeTelemetry({speedKph: 80, updatedAt: 1_000_000});
    store.mergeTelemetry({speedKph: 80, updatedAt: 1_600_000});

    expect(useSession.getState().trip!.distanceKm).toBe(0);
  });

  it('keeps the peaks it has seen', () => {
    const store = useSession.getState();
    store.startTrip();
    store.mergeTelemetry({speedKph: 90, rpm: 7000, updatedAt: 1_000});
    store.mergeTelemetry({speedKph: 40, rpm: 3000, updatedAt: 2_000});

    const trip = useSession.getState().trip!;
    expect(trip.maxSpeedKph).toBe(90);
    expect(trip.maxRpm).toBe(7000);
  });

  it('sorts likely matches to the top of the device list', () => {
    const store = useSession.getState();
    store.addDevice('telemetry', {id: 'a', name: 'Headset', likelyMatch: false, rssi: -40});
    store.addDevice('telemetry', {id: 'b', name: 'OBDII', likelyMatch: true, rssi: -80});
    store.addDevice('telemetry', {id: 'b', name: 'OBDII duplicate', likelyMatch: true});

    const devices = useSession.getState().devices.telemetry;
    expect(devices.map(d => d.id)).toEqual(['b', 'a']);
  });

  it('caps the log so a long ride cannot grow it without bound', () => {
    const store = useSession.getState();
    for (let i = 0; i < 250; i++) {
      store.appendLog('app', `line ${i}`);
    }
    const log = useSession.getState().log;
    expect(log).toHaveLength(200);
    expect(log[log.length - 1].text).toBe('line 249');
  });
});
