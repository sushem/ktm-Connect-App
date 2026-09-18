import {KTM_SERVICE_UUID} from '../../../transport/KtmLinkTransport';
import {
  connectableServices,
  connectionCandidates,
  describeService,
  describeServices,
  hasMyRide,
  shortUuid,
} from '../services';

const SPP = '00001101-0000-1000-8000-00805f9b34fb';
const HANDSFREE = '0000111e-0000-1000-8000-00805f9b34fb';
const A2DP_SINK = '0000110b-0000-1000-8000-00805f9b34fb';
const VENDOR = 'a1b2c3d4-1111-2222-3333-444455556666';

describe('shortUuid', () => {
  it('extracts the 16-bit form of a standard UUID', () => {
    expect(shortUuid(SPP)).toBe('1101');
  });

  it('returns nothing for a vendor UUID', () => {
    expect(shortUuid(VENDOR)).toBeNull();
    expect(shortUuid(KTM_SERVICE_UUID)).toBeNull();
  });
});

describe('describeService', () => {
  it('names the standard profiles', () => {
    expect(describeService(SPP).label).toBe('Serial Port (SPP)');
    expect(describeService(HANDSFREE).label).toBe('Hands-Free');
  });

  it('recognises the MY RIDE service whatever case it arrives in', () => {
    expect(describeService(KTM_SERVICE_UUID.toUpperCase()).isMyRide).toBe(true);
    expect(describeService(SPP).isMyRide).toBe(false);
  });

  it('falls back to the UUID for something it does not know', () => {
    const service = describeService(VENDOR);
    expect(service.label).toBe(VENDOR);
    expect(service.isStandard).toBe(false);
  });

  it('labels an unrecognised standard UUID by its short form', () => {
    expect(describeService('00001234-0000-1000-8000-00805f9b34fb').label).toBe(
      'Standard service 0x1234',
    );
  });
});

describe('describeServices', () => {
  it('puts MY RIDE first, then vendor services, then standard profiles', () => {
    const ordered = describeServices([HANDSFREE, VENDOR, KTM_SERVICE_UUID, SPP]);
    expect(ordered.map(service => service.uuid)).toEqual([
      KTM_SERVICE_UUID.toLowerCase(),
      VENDOR,
      HANDSFREE,
      SPP,
    ]);
  });

  it('drops duplicates that differ only in case', () => {
    expect(describeServices([SPP, SPP.toUpperCase()])).toHaveLength(1);
  });
});

describe('hasMyRide', () => {
  it('is the question the connect error cannot answer', () => {
    expect(hasMyRide([HANDSFREE, A2DP_SINK])).toBe(false);
    expect(hasMyRide([HANDSFREE, KTM_SERVICE_UUID])).toBe(true);
  });
});

describe('connectableServices', () => {
  it('offers MY RIDE, plain serial ports and vendor services', () => {
    const candidates = connectableServices([HANDSFREE, A2DP_SINK, SPP, VENDOR, KTM_SERVICE_UUID]);
    expect(candidates.map(service => service.uuid)).toEqual([
      KTM_SERVICE_UUID.toLowerCase(),
      VENDOR,
      SPP,
    ]);
  });

  it('leaves out audio and phone profiles, which are not serial ports', () => {
    expect(connectableServices([HANDSFREE, A2DP_SINK])).toEqual([]);
  });
});

describe('connectionCandidates', () => {
  it('always leads with MY RIDE, even when SDP did not list it', () => {
    const candidates = connectionCandidates([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isMyRide).toBe(true);
  });

  it('falls back to the serial port a dashboard without MY RIDE advertises', () => {
    // What a 390 Adventure reports: audio and phone profiles, plus a plain SPP.
    const candidates = connectionCandidates([HANDSFREE, SPP, A2DP_SINK]);

    expect(candidates.map(service => service.label)).toEqual([
      'KTM MY RIDE',
      'Serial Port (SPP)',
    ]);
  });

  it('does not try MY RIDE twice when the device does advertise it', () => {
    const candidates = connectionCandidates([KTM_SERVICE_UUID, SPP]);
    expect(candidates.filter(service => service.isMyRide)).toHaveLength(1);
  });

  it('puts a vendor service ahead of a generic serial port', () => {
    const candidates = connectionCandidates([SPP, VENDOR]);
    expect(candidates.map(service => service.uuid)).toEqual([
      KTM_SERVICE_UUID.toLowerCase(),
      VENDOR,
      SPP,
    ]);
  });
});
