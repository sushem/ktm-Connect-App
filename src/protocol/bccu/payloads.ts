import {utf8Encode} from '../ktm/framing';

/**
 * Payload shapes for the Gen-3 dashboard's characteristics.
 *
 * Each field is its own characteristic and its own tiny binary payload —
 * nothing like the JSON document the older serial dashboards take. Field
 * lengths and the truncation rule come from the Navigator Gen3 project
 * (github.com/Pavanayi1/KTM-Nav-GEN3, MIT).
 */

/** Not a boolean: the dashboard reads three states from this byte. */
export enum Visibility {
  Off = 1,
  Half = 2,
  Full = 3,
}

export enum TurnIcon {
  Unknown = 0,
  Undefined = 1,
  GoStraight = 2,
  UturnRight = 3,
  UturnLeft = 4,
  KeepRight = 5,
  LightRight = 6,
  QuiteRight = 7,
  HeavyRight = 8,
  KeepMiddle = 9,
  KeepLeft = 10,
  LightLeft = 11,
  QuiteLeft = 12,
  HeavyLeft = 13,
  EnterHighwayRightLane = 14,
  EnterHighwayLeftLane = 15,
  LeaveHighwayRightLane = 16,
  LeaveHighwayLeftLane = 17,
  HighwayKeepRight = 18,
  HighwayKeepLeft = 19,
  Start = 20,
  End = 21,
  Ferry = 22,
  PassStation = 23,
  HeadTo = 24,
  ChangeLine = 25,
  Roundabout1Right = 26,
  Roundabout2Right = 27,
  Roundabout3Right = 28,
  Roundabout4Right = 29,
  Roundabout5Right = 30,
  Roundabout6Right = 31,
}

export enum NotificationIcon {
  Unknown = 0,
  Rerouting = 1,
  Waypoint = 2,
  TargetReached = 3,
  GpsLost = 4,
  Warning = 5,
  Information = 6,
  Speed = 7,
}

/** The dashboard's notification banner holds this many characters. */
export const NOTIFICATION_MAX_CHARS = 16;

/**
 * Truncate the way the official app does: leave it alone if it fits,
 * otherwise cut and append an ellipsis. Counts UTF-16 units, as the original
 * does, so the dashboard's own limit is never exceeded.
 */
export function elipse(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

/** `[visibility][UTF-8 text]`, shared by every text field. */
function labelPayload(text: string, maxLength: number, visibility: Visibility): Uint8Array {
  const body = utf8Encode(elipse(text, maxLength));
  const out = new Uint8Array(1 + body.length);
  out[0] = visibility;
  out.set(body, 1);
  return out;
}

/** Distance to the next turn, e.g. "110 m". */
export const turnDistancePayload = (text: string, visibility = Visibility.Full) =>
  labelPayload(text, 8, visibility);

/** Secondary manoeuvre text. */
export const turnInfoPayload = (text: string, visibility = Visibility.Full) =>
  labelPayload(text, 16, visibility);

/** Road name, e.g. "towards 1st Cross Rd". */
export const turnRoadPayload = (text: string, visibility = Visibility.Full) =>
  labelPayload(text, 32, visibility);

/** Arrival time, e.g. "12:45". */
export const etaPayload = (text: string, visibility = Visibility.Full) =>
  labelPayload(text, 8, visibility);

/** Distance still to run, e.g. "123 km". */
export const remainingDistancePayload = (text: string, visibility = Visibility.Full) =>
  labelPayload(text, 8, visibility);

export function turnIconPayload(icon: TurnIcon, visibility = Visibility.Full): Uint8Array {
  return Uint8Array.from([visibility, icon]);
}

/** `[visibility][icon][UTF-8 text]`, text capped at the banner width. */
export function notificationPayload(
  text: string,
  icon: NotificationIcon = NotificationIcon.Information,
  visibility = Visibility.Full,
): Uint8Array {
  const body = utf8Encode(text.slice(0, NOTIFICATION_MAX_CHARS));
  const out = new Uint8Array(2 + body.length);
  out[0] = visibility;
  out[1] = icon;
  out.set(body, 2);
  return out;
}

/**
 * `[flags][volume]`, where flags bit 0 is guidance and bit 1 the GPS icon.
 *
 * The dashboard will not render the turn or notification fields until
 * guidance is on, so this is the first thing to send after authenticating.
 */
export function navigationStatePayload(
  guidanceOn: boolean,
  gpsIconOn: boolean,
  volume = 255,
): Uint8Array {
  const flags = (guidanceOn ? 1 : 0) | ((gpsIconOn ? 1 : 0) << 1);
  return Uint8Array.from([flags, volume & 0xff]);
}
