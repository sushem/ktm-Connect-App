/**
 * Message bodies for the KTM MY RIDE link.
 *
 * The dashboard is a dumb renderer: it draws the fields you send it and keeps
 * drawing them until you send something else. Each field is an object with a
 * value and a `Visibility` flag, so hiding a field means sending it as `off`
 * rather than omitting it.
 */

export type UiContext = 'default' | 'guidance';

export type TurnIcon =
  | 'END'
  | 'HEAVY_LEFT'
  | 'HEAVY_RIGHT'
  | 'KEEP_LEFT'
  | 'KEEP_RIGHT'
  | 'QUITE_LEFT'
  | 'QUITE_RIGHT'
  | 'LIGHT_LEFT'
  | 'LIGHT_RIGHT'
  | 'GO_STRAIGHT'
  | 'UTURN_LEFT'
  | 'UTURN_RIGHT'
  | 'LEAVE_HIGHWAY_RIGHT_LANE'
  | 'LEAVE_HIGHWAY_LEFT_LANE'
  | 'FERRY'
  | 'RAB_SECT_4_LH'
  | 'RAB_SECT_4_RH'
  | 'RAB_SECT_6_LH'
  | 'RAB_SECT_6_RH'
  | 'RAB_SECT_8_LH'
  | 'RAB_SECT_8_RH'
  | 'RAB_SECT_10_LH'
  | 'RAB_SECT_10_RH'
  | 'RAB_SECT_12_LH'
  | 'RAB_SECT_12_RH'
  | 'RAB_SECT_14_LH'
  | 'RAB_SECT_14_RH'
  | 'RAB_SECT_16_LH'
  | 'RAB_SECT_16_RH';

export const TURN_ICONS: TurnIcon[] = [
  'GO_STRAIGHT',
  'LIGHT_LEFT',
  'LIGHT_RIGHT',
  'QUITE_LEFT',
  'QUITE_RIGHT',
  'HEAVY_LEFT',
  'HEAVY_RIGHT',
  'KEEP_LEFT',
  'KEEP_RIGHT',
  'UTURN_LEFT',
  'UTURN_RIGHT',
  'LEAVE_HIGHWAY_LEFT_LANE',
  'LEAVE_HIGHWAY_RIGHT_LANE',
  'RAB_SECT_4_RH',
  'RAB_SECT_6_RH',
  'RAB_SECT_8_RH',
  'RAB_SECT_10_RH',
  'RAB_SECT_12_RH',
  'FERRY',
  'END',
];

/** Everything the dashboard will render, as we choose to model it. */
export interface DashboardView {
  uiContext: UiContext;
  /** Street or road name on the guidance screen. */
  turnRoad?: string;
  /** Distance to the next turn, e.g. "350". */
  turnDist?: string;
  /** Unit shown next to `turnDist`, e.g. "m" or "km". */
  turnDistUnit?: string;
  turnIcon?: TurnIcon;
  /** Distance to destination, e.g. "42 km". */
  dist2Target?: string;
  /** Arrival time, e.g. "14:35". */
  eta?: string;
  /** Free line under the turn info. */
  turnInfo?: string;
  /** Notification line, shown in both contexts. */
  notificationText?: string;
  /** The little satellite glyph; send `undefined` to hide it. */
  gpsIcon?: string;
}

interface FieldText {
  Text: string;
  Visibility: 'full' | 'off';
}

interface FieldIcon {
  Image: string;
  Visibility: 'full' | 'off';
}

export interface DashboardMessage {
  UiContext: UiContext;
  UpdateUI: {
    TurnRoad: FieldText;
    TurnDist: FieldText;
    TurnDistUnit: FieldText;
    TurnIcon: FieldIcon;
    GpsIcon: FieldIcon;
    Dist2Target: FieldText;
    ETA: FieldText;
    TurnInfo: FieldText;
    NotificationText: FieldText;
    NotificationIcon: { Visibility: 'off' };
  };
  MsgId: string;
}

const text = (value?: string): FieldText => ({
  Text: value ?? '',
  Visibility: value == null ? 'off' : 'full',
});

const icon = (value?: string): FieldIcon => ({
  Image: value ?? 'UNDEFINED',
  Visibility: value == null ? 'off' : 'full',
});

/**
 * Build the JSON body for a view. `sequence` is a counter the dashboard uses to
 * order updates; it must increase for the display to accept a new frame.
 */
export function buildMessage(view: DashboardView, sequence: number): DashboardMessage {
  const prefix = view.uiContext === 'guidance' ? 'gon' : 'Restore';
  return {
    UiContext: view.uiContext,
    UpdateUI: {
      TurnRoad: text(view.turnRoad),
      TurnDist: text(view.turnDist),
      TurnDistUnit: text(view.turnDistUnit),
      TurnIcon: icon(view.turnIcon),
      GpsIcon: icon(view.gpsIcon),
      Dist2Target: text(view.dist2Target),
      ETA: text(view.eta),
      TurnInfo: text(view.turnInfo),
      NotificationText: text(view.notificationText),
      NotificationIcon: { Visibility: 'off' },
    },
    MsgId: `${prefix}#${sequence}`,
  };
}

export function serializeMessage(view: DashboardView, sequence: number): string {
  return JSON.stringify(buildMessage(view, sequence));
}

/** The view that hands the display back to the bike's own screens. */
export function restoreView(): DashboardView {
  return { uiContext: 'default', gpsIcon: 'GPS' };
}

/** A plain line of text on the default screen. */
export function notificationView(message: string): DashboardView {
  return { uiContext: 'default', gpsIcon: 'GPS', notificationText: message };
}

export interface GuidanceInput {
  icon: TurnIcon;
  road?: string;
  /** Metres to the next manoeuvre. */
  distanceM?: number;
  /** Metres remaining to the destination. */
  remainingM?: number;
  /** Arrival time as epoch ms. */
  etaAt?: number;
  info?: string;
}

export function guidanceView(input: GuidanceInput): DashboardView {
  const turn = input.distanceM == null ? undefined : formatDistance(input.distanceM);
  return {
    uiContext: 'guidance',
    gpsIcon: 'GPS',
    turnIcon: input.icon,
    turnRoad: input.road,
    turnDist: turn?.value,
    turnDistUnit: turn?.unit,
    dist2Target:
      input.remainingM == null
        ? undefined
        : (() => {
            const d = formatDistance(input.remainingM);
            return `${d.value} ${d.unit}`;
          })(),
    eta: input.etaAt == null ? undefined : formatClock(input.etaAt),
    turnInfo: input.info,
  };
}

export function formatDistance(metres: number): { value: string; unit: string } {
  const m = Math.max(0, metres);
  if (m < 1000) {
    // The dashboard font is narrow; round to something a rider can read at speed.
    const rounded = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
    return { value: String(rounded), unit: 'm' };
  }
  const km = m / 1000;
  return { value: km < 10 ? km.toFixed(1) : String(Math.round(km)), unit: 'km' };
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
