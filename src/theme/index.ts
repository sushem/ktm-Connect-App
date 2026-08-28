/**
 * A dark, high-contrast palette: the phone usually lives on a bar mount in
 * daylight, so everything is either very bright or very dark, with KTM orange
 * reserved for the values that matter.
 */
export const colors = {
  background: '#0B0D10',
  surface: '#14181D',
  surfaceRaised: '#1C222A',
  border: '#262E38',
  text: '#F2F5F7',
  textMuted: '#8A98A8',
  accent: '#FF6600',
  accentMuted: '#7A3200',
  success: '#3DDC84',
  warning: '#FFB020',
  danger: '#FF4D4F',
  gauge: '#2A323C',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const typography = {
  display: {fontSize: 64, fontWeight: '800' as const, letterSpacing: -2},
  title: {fontSize: 22, fontWeight: '700' as const},
  heading: {fontSize: 15, fontWeight: '700' as const, letterSpacing: 0.8},
  body: {fontSize: 15, fontWeight: '500' as const},
  label: {fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6},
  value: {fontSize: 26, fontWeight: '700' as const},
};
