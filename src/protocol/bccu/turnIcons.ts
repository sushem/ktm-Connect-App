import type {TurnIcon as LegacyTurnIcon} from '../ktm/messages';
import {TurnIcon} from './payloads';

/**
 * The two dashboard generations name the same manoeuvres differently: the
 * serial protocol uses strings, the Gen-3 one a numeric code. The app's UI
 * speaks the string form, so this is where it crosses over.
 */
const BY_NAME: Partial<Record<LegacyTurnIcon, TurnIcon>> = {
  GO_STRAIGHT: TurnIcon.GoStraight,
  KEEP_LEFT: TurnIcon.KeepLeft,
  KEEP_RIGHT: TurnIcon.KeepRight,
  LIGHT_LEFT: TurnIcon.LightLeft,
  LIGHT_RIGHT: TurnIcon.LightRight,
  QUITE_LEFT: TurnIcon.QuiteLeft,
  QUITE_RIGHT: TurnIcon.QuiteRight,
  HEAVY_LEFT: TurnIcon.HeavyLeft,
  HEAVY_RIGHT: TurnIcon.HeavyRight,
  UTURN_LEFT: TurnIcon.UturnLeft,
  UTURN_RIGHT: TurnIcon.UturnRight,
  LEAVE_HIGHWAY_LEFT_LANE: TurnIcon.LeaveHighwayLeftLane,
  LEAVE_HIGHWAY_RIGHT_LANE: TurnIcon.LeaveHighwayRightLane,
  FERRY: TurnIcon.Ferry,
  END: TurnIcon.End,
  RAB_SECT_4_RH: TurnIcon.Roundabout4Right,
  RAB_SECT_6_RH: TurnIcon.Roundabout6Right,
};

export function toGen3Icon(icon: LegacyTurnIcon | undefined): TurnIcon {
  if (!icon) {
    return TurnIcon.Undefined;
  }
  // A roundabout exit the Gen-3 table does not carry falls back to the
  // generic arrow rather than drawing the wrong exit number.
  return BY_NAME[icon] ?? TurnIcon.Undefined;
}
