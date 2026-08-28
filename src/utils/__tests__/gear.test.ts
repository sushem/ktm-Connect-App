import {BIKE_PROFILES, DEFAULT_PROFILE, estimateGear} from '../gear';

describe('estimateGear', () => {
  it('picks the gear whose ratio matches the measured one', () => {
    // 85 rpm per km/h is third on the default profile.
    expect(estimateGear(85 * 60, 60, DEFAULT_PROFILE)).toBe(3);
    expect(estimateGear(155 * 20, 20, DEFAULT_PROFILE)).toBe(1);
    expect(estimateGear(55 * 130, 130, DEFAULT_PROFILE)).toBe(6);
  });

  it('tolerates a few percent of slip and rounding', () => {
    expect(estimateGear(85 * 60 * 1.05, 60, DEFAULT_PROFILE)).toBe(3);
  });

  it('says nothing rather than guessing when the ratio fits no gear', () => {
    expect(estimateGear(9000, 20, DEFAULT_PROFILE)).toBeUndefined();
  });

  it('stays quiet at a standstill and with the clutch in', () => {
    expect(estimateGear(3000, 0, DEFAULT_PROFILE)).toBeUndefined();
    expect(estimateGear(undefined, 60, DEFAULT_PROFILE)).toBeUndefined();
    expect(estimateGear(600, 60, DEFAULT_PROFILE)).toBeUndefined();
  });

  it('ships profiles with ratios that fall as the gears rise', () => {
    BIKE_PROFILES.forEach(profile => {
      const descending = profile.ratios.every(
        (ratio, index) => index === 0 || ratio < profile.ratios[index - 1],
      );
      expect(descending).toBe(true);
      expect(profile.redlineRpm).toBeLessThanOrEqual(profile.maxRpm);
    });
  });
});
