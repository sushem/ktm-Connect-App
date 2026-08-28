import {distance, duration, integer, speed, temperature} from '../units';

describe('unit formatting', () => {
  it('converts speed for imperial riders', () => {
    expect(speed(100, 'metric')).toBe('100');
    expect(speed(100, 'imperial')).toBe('62');
  });

  it('converts temperature', () => {
    expect(temperature(20, 'metric')).toBe('20°');
    expect(temperature(20, 'imperial')).toBe('68°');
  });

  it('keeps one decimal on short distances only', () => {
    expect(distance(4.25, 'metric')).toBe('4.3');
    expect(distance(42, 'metric')).toBe('42');
  });

  it('shows a dash when a value is missing rather than a zero', () => {
    expect(speed(undefined, 'metric')).toBe('—');
    expect(temperature(undefined, 'metric')).toBe('—');
    expect(integer(undefined)).toBe('—');
    expect(distance(undefined, 'metric')).toBe('—');
  });

  it('formats ride time', () => {
    expect(duration(90_000)).toBe('1m');
    expect(duration(3_900_000)).toBe('1h 05m');
  });
});
