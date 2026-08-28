import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {colors, radius, spacing, typography} from '../theme';

interface OptionRowProps<T extends string | number> {
  label: string;
  options: Array<{value: T; label: string}>;
  value: T;
  onChange: (value: T) => void;
}

/** A compact segmented control; wraps to more than one line when it has to. */
export function OptionRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: OptionRowProps<T>) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.options}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{selected}}
              onPress={() => onChange(option.value)}
              style={[styles.option, selected ? styles.optionSelected : null]}>
              <Text style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {gap: spacing.sm},
  label: {...typography.label, color: colors.textMuted, fontSize: 11},
  options: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  option: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionSelected: {borderColor: colors.accent, backgroundColor: colors.accentMuted},
  optionLabel: {...typography.label, color: colors.textMuted},
  optionLabelSelected: {color: colors.text},
});
