/**
 * Gear estimation.
 *
 * Bikes do not report the selected gear over standard OBD-II, but in any given
 * gear the ratio between engine speed and road speed is fixed. We compare the
 * measured ratio against a table for the bike and take the closest match, which
 * is what most aftermarket gear indicators do.
 */

export interface BikeProfile {
  id: string;
  name: string;
  /** rpm per km/h, one entry per gear starting at first. */
  ratios: number[];
  /** Where the tachometer turns red. */
  redlineRpm: number;
  /** Full-scale deflection on the tachometer. */
  maxRpm: number;
}

/** Ratios measured on a 790 Adventure; close enough to start with on most twins. */
export const DEFAULT_PROFILE: BikeProfile = {
  id: 'generic-twin',
  name: 'Generic twin (6 speed)',
  ratios: [155, 108, 85, 71, 62, 55],
  redlineRpm: 9500,
  maxRpm: 11000,
};

export const BIKE_PROFILES: BikeProfile[] = [
  DEFAULT_PROFILE,
  {
    id: 'ktm-390',
    name: 'KTM 390 (6 speed)',
    ratios: [225, 158, 124, 104, 91, 82],
    redlineRpm: 9500,
    maxRpm: 11000,
  },
  {
    id: 'ktm-690',
    name: 'KTM 690 (6 speed)',
    ratios: [168, 118, 93, 78, 68, 60],
    redlineRpm: 8500,
    maxRpm: 10000,
  },
  {
    id: 'ktm-1290',
    name: 'KTM 1290 (6 speed)',
    ratios: [128, 92, 74, 62, 55, 49],
    redlineRpm: 9500,
    maxRpm: 11000,
  },
];

/** How far the measured ratio may sit from a gear's ratio and still match. */
const TOLERANCE = 0.14;

export function estimateGear(
  rpm: number | undefined,
  speedKph: number | undefined,
  profile: BikeProfile = DEFAULT_PROFILE,
): number | undefined {
  if (rpm == null || speedKph == null || speedKph < 5 || rpm < 800) {
    return undefined;
  }
  const measured = rpm / speedKph;

  let best: number | undefined;
  let bestError = Infinity;
  profile.ratios.forEach((ratio, index) => {
    const error = Math.abs(measured - ratio) / ratio;
    if (error < bestError) {
      bestError = error;
      best = index + 1;
    }
  });

  return bestError <= TOLERANCE ? best : undefined;
}
