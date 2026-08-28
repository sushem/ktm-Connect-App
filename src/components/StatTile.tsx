import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {colors, radius, spacing, typography} from '../theme';

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  /** Highlight the value, e.g. a coolant temperature that is climbing. */
  tone?: 'normal' | 'warning' | 'danger';
}

export function StatTile({label, value, unit, tone = 'normal'}: StatTileProps) {
  const valueColor =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.text;
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, {color: valueColor}]} numberOfLines={1}>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {...typography.label, color: colors.textMuted, fontSize: 11},
  valueRow: {flexDirection: 'row', alignItems: 'baseline', gap: 3},
  value: {...typography.value},
  unit: {...typography.label, color: colors.textMuted},
});
