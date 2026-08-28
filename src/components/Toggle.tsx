import React from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';

import {colors, spacing, typography} from '../theme';

interface ToggleProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({label, hint, value, onChange, disabled}: ToggleProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.label, disabled ? styles.disabled : null]}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{true: colors.accentMuted, false: colors.border}}
        thumbColor={value ? colors.accent : colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
  text: {flexShrink: 1, gap: 2},
  label: {...typography.body, color: colors.text},
  hint: {...typography.label, color: colors.textMuted, fontWeight: '500', lineHeight: 17},
  disabled: {color: colors.textMuted},
});
