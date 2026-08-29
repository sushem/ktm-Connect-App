/**
 * Reading a device's SDP record.
 *
 * When an RFCOMM connect fails, Android says "read failed, socket might closed
 * or timeout" whether the service is missing, the device is busy or the pairing
 * is stale. Listing what the device actually offers separates those cases, and
 * on a dashboard without MY RIDE it explains the failure outright.
 */

import {KTM_SERVICE_UUID} from '../../transport/KtmLinkTransport';

/** The 16-bit shorthand sits in this template; everything else is a vendor UUID. */
const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

const WELL_KNOWN: Record<string, string> = {
  '1101': 'Serial Port (SPP)',
  '1103': 'Dial-up Networking',
  '1105': 'OBEX Object Push',
  '1106': 'OBEX File Transfer',
  '1108': 'Headset',
  '110a': 'Audio Source (A2DP)',
  '110b': 'Audio Sink (A2DP)',
  '110c': 'A/V Remote Control Target',
  '110e': 'A/V Remote Control',
  '110f': 'A/V Remote Control Controller',
  '1112': 'Headset Audio Gateway',
  '1115': 'Personal Area Network',
  '1116': 'Network Access Point',
  '111e': 'Hands-Free',
  '111f': 'Hands-Free Audio Gateway',
  '1124': 'Human Interface Device',
  '112d': 'SIM Access',
  '112e': 'Phone Book Access Client',
  '112f': 'Phone Book Access Server',
  '1130': 'Phone Book Access',
  '1132': 'Message Access Server',
  '1133': 'Message Notification Server',
  '1134': 'Message Access',
  '1200': 'Device Identification',
  '1203': 'Generic Audio',
  '1204': 'Generic Telephony',
};

export interface BluetoothService {
  uuid: string;
  /** A readable name where we know one, otherwise the UUID itself. */
  label: string;
  /** True for the vendor UUID the MY RIDE dashboard registers. */
  isMyRide: boolean;
  /** Standard Bluetooth profile rather than something vendor-specific. */
  isStandard: boolean;
}

export function normalizeUuid(uuid: string): string {
  return uuid.trim().toLowerCase();
}

/** The 16-bit shorthand, when the UUID is a standard one. */
export function shortUuid(uuid: string): string | null {
  const normalized = normalizeUuid(uuid);
  if (!normalized.endsWith(BASE_SUFFIX)) {
    return null;
  }
  const prefix = normalized.slice(0, 8);
  return prefix.startsWith('0000') ? prefix.slice(4) : prefix;
}

export function describeService(uuid: string): BluetoothService {
  const normalized = normalizeUuid(uuid);
  const short = shortUuid(normalized);
  const known = short ? WELL_KNOWN[short] : undefined;
  const isMyRide = normalized === normalizeUuid(KTM_SERVICE_UUID);

  return {
    uuid: normalized,
    label: isMyRide
      ? 'KTM MY RIDE'
      : (known ?? (short ? `Standard service 0x${short.toUpperCase()}` : normalized)),
    isMyRide,
    isStandard: short != null,
  };
}

export function describeServices(uuids: string[]): BluetoothService[] {
  const seen = new Set<string>();
  return uuids
    .map(describeService)
    .filter(service => {
      if (seen.has(service.uuid)) {
        return false;
      }
      seen.add(service.uuid);
      return true;
    })
    // MY RIDE first, then vendor services (the interesting ones), then profiles.
    .sort((a, b) => {
      if (a.isMyRide !== b.isMyRide) {
        return a.isMyRide ? -1 : 1;
      }
      if (a.isStandard !== b.isStandard) {
        return a.isStandard ? 1 : -1;
      }
      return a.label.localeCompare(b.label);
    });
}

export function hasMyRide(uuids: string[]): boolean {
  return uuids.some(uuid => normalizeUuid(uuid) === normalizeUuid(KTM_SERVICE_UUID));
}

/**
 * Services worth trying a socket against when MY RIDE is absent: the Serial
 * Port Profile, and any vendor UUID, which is what a renamed or newer version
 * of the dashboard's service would look like. Audio and phonebook profiles are
 * not serial ports and only waste the rider's time.
 */
export function connectableServices(uuids: string[]): BluetoothService[] {
  return describeServices(uuids).filter(
    service => service.isMyRide || !service.isStandard || shortUuid(service.uuid) === '1101',
  );
}

/**
 * The order to try services in when opening the dashboard link: MY RIDE first
 * because it is what the protocol was written against, then whatever else on
 * the device could carry a serial stream. Always includes MY RIDE, even when
 * the device did not advertise it — SDP records are not always complete, and
 * an attempt costs a second.
 */
export function connectionCandidates(advertised: string[]): BluetoothService[] {
  const candidates = [describeService(KTM_SERVICE_UUID), ...connectableServices(advertised)];
  return candidates.filter(
    (service, index) => candidates.findIndex(other => other.uuid === service.uuid) === index,
  );
}
