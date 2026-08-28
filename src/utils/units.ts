export type UnitSystem = 'metric' | 'imperial';

export const kphToMph = (kph: number): number => kph * 0.621371;
export const celsiusToFahrenheit = (c: number): number => c * 1.8 + 32;
export const kmToMiles = (km: number): number => km * 0.621371;

export function speed(value: number | undefined, units: UnitSystem): string {
  if (value == null) {
    return '—';
  }
  return String(Math.round(units === 'metric' ? value : kphToMph(value)));
}

export const speedUnit = (units: UnitSystem): string => (units === 'metric' ? 'km/h' : 'mph');

export function temperature(value: number | undefined, units: UnitSystem): string {
  if (value == null) {
    return '—';
  }
  return `${Math.round(units === 'metric' ? value : celsiusToFahrenheit(value))}°`;
}

export const temperatureUnit = (units: UnitSystem): string => (units === 'metric' ? 'C' : 'F');

export function distance(km: number | undefined, units: UnitSystem): string {
  if (km == null) {
    return '—';
  }
  const value = units === 'metric' ? km : kmToMiles(km);
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

export const distanceUnit = (units: UnitSystem): string => (units === 'metric' ? 'km' : 'mi');

export function decimals(value: number | undefined, places = 1): string {
  return value == null ? '—' : value.toFixed(places);
}

export function integer(value: number | undefined): string {
  return value == null ? '—' : String(Math.round(value));
}

export function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}
