/**
 * GATT layout for the BCCU protocol — the BLE service a Gen-3 KTM or
 * Husqvarna dashboard exposes.
 *
 * This is a different protocol from the older MY RIDE serial link: BLE rather
 * than Bluetooth Classic, one characteristic per field rather than a JSON
 * document, and every write encrypted under a session key negotiated at
 * connect time.
 *
 * UUIDs and payload shapes come from the Navigator Gen3 project
 * (github.com/Pavanayi1/KTM-Nav-GEN3, MIT), which documents them as confirmed
 * byte-exact against two independent implementations.
 */

const uuid = (suffix: string) => `71ced1ac-${suffix}-44f5-9454-806ff70b3e02`;

export const MAIN_SERVICE = uuid('0700');
/** Indications from the bike: nonces and handshake commands. */
export const AUTH_REQUEST = uuid('0701');
/** Our side of the handshake. */
export const AUTH_REPLY = uuid('0702');
export const NAVIGATION_STATE = uuid('0703');
export const TURN_ICON = uuid('0704');
export const TURN_DISTANCE = uuid('0705');
export const TURN_INFO = uuid('0706');
export const TURN_ROAD = uuid('0707');
export const ETA = uuid('0708');
export const REMAINING_DISTANCE = uuid('0709');
export const NOTIFICATION = uuid('070a');
/** The dashboard asks for navigation data on this one; the reference subscribes. */
export const TBT_NAV_REQUEST = uuid('070b');
export const TBT_NAV_RESPONSE = uuid('070c');

export const BASE_SERVICE = uuid('0000');
export const BASE_VIN = uuid('0002');

/** Standard Bluetooth SIG Device Information: model, firmware, serial. */
export const DEVICE_INFO_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
export const DEVICE_INFO_MODEL = '00002a24-0000-1000-8000-00805f9b34fb';
export const DEVICE_INFO_FIRMWARE = '00002a26-0000-1000-8000-00805f9b34fb';

/** Handlebar remote control. Not used yet, but it is on the same service tree. */
export const RCM_SERVICE = uuid('0100');
export const RCM_REMOTE_CONTROL = uuid('0103');

/** Handshake commands, carried in byte 2 of a decrypted control message. */
export const CMD_HELLO = 0;
export const CMD_GENERATE_KEYS = 1;
/** The bike selects a session key by sending 16 | index. */
export const CMD_KEY_ACK_BASE = 16;
