import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, G, Line, Path, Text as SvgText} from 'react-native-svg';

import {colors, typography} from '../theme';

interface GaugeProps {
  /** Current value; `undefined` renders an empty gauge rather than a zero. */
  value?: number;
  max: number;
  /** Values at or above this are drawn in red. */
  redline?: number;
  /** Spacing between labelled ticks, in value units. */
  tickEvery?: number;
  size?: number;
  label: string;
  /** Large readout in the middle of the dial. */
  centerValue: string;
  centerUnit?: string;
  /** Small line under the readout, e.g. the selected gear. */
  centerCaption?: string;
}

const START_ANGLE = 135;
const SWEEP = 270;

/**
 * A 270° dial. The arc is drawn as an SVG path rather than a dashed circle so
 * that the sweep, the redline segment and the ticks all share one geometry.
 */
export function Gauge({
  value,
  max,
  redline,
  tickEvery,
  size = 260,
  label,
  centerValue,
  centerUnit,
  centerCaption,
}: GaugeProps) {
  const stroke = Math.max(10, size * 0.055);
  const radius = size / 2 - stroke / 2 - size * 0.06;
  const center = size / 2;
  const clamped = Math.max(0, Math.min(max, value ?? 0));
  const valueAngle = START_ANGLE + (clamped / max) * SWEEP;

  const step = tickEvery ?? max / 8;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + 1e-6; tick += step) {
    ticks.push(tick);
  }

  return (
    <View style={[styles.wrapper, {width: size, height: size}]}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius + stroke} fill={colors.surface} />
        <Path
          d={arcPath(center, center, radius, START_ANGLE, START_ANGLE + SWEEP)}
          stroke={colors.gauge}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {redline != null ? (
          <Path
            d={arcPath(center, center, radius, START_ANGLE + (redline / max) * SWEEP, START_ANGLE + SWEEP)}
            stroke={colors.accentMuted}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        {value != null && clamped > 0 ? (
          <Path
            d={arcPath(center, center, radius, START_ANGLE, valueAngle)}
            stroke={redline != null && clamped >= redline ? colors.danger : colors.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        <G>
          {ticks.map(tick => {
            const angle = START_ANGLE + (tick / max) * SWEEP;
            const outer = pointOn(center, center, radius - stroke * 0.9, angle);
            const inner = pointOn(center, center, radius - stroke * 1.5, angle);
            const labelAt = pointOn(center, center, radius - stroke * 2.6, angle);
            return (
              <G key={tick}>
                <Line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={redline != null && tick >= redline ? colors.danger : colors.textMuted}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={labelAt.x}
                  y={labelAt.y + 4}
                  fill={colors.textMuted}
                  fontSize={Math.max(9, size * 0.042)}
                  fontWeight="600"
                  textAnchor="middle">
                  {formatTick(tick, max)}
                </SvgText>
              </G>
            );
          })}
        </G>
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
            {centerValue}
          </Text>
          {centerUnit ? <Text style={styles.unit}>{centerUnit}</Text> : null}
        </View>
        {centerCaption ? <Text style={styles.caption}>{centerCaption}</Text> : null}
      </View>
    </View>
  );
}

function formatTick(tick: number, max: number): string {
  if (max >= 4000) {
    return String(Math.round(tick / 1000));
  }
  return String(Math.round(tick));
}

function pointOn(cx: number, cy: number, r: number, angleDeg: number): {x: number; y: number} {
  const radians = (angleDeg * Math.PI) / 180;
  return {x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians)};
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const from = pointOn(cx, cy, r, fromDeg);
  const to = pointOn(cx, cy, r, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${r} ${r} 0 ${largeArc} 1 ${to.x} ${to.y}`;
}

const styles = StyleSheet.create({
  wrapper: {alignItems: 'center', justifyContent: 'center', alignSelf: 'center'},
  center: {position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  label: {...typography.label, color: colors.textMuted},
  valueRow: {flexDirection: 'row', alignItems: 'baseline', gap: 4},
  value: {...typography.display, color: colors.text, fontSize: 56},
  unit: {...typography.label, color: colors.textMuted},
  caption: {...typography.label, color: colors.accent, marginTop: 2},
});
