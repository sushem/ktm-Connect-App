import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle} from 'react-native';

import {colors, radius, spacing, typography} from '../theme';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}

export function Button({label, onPress, variant = 'primary', disabled, busy, style}: ButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!inactive, busy: !!busy}}
      onPress={onPress}
      disabled={inactive}
      style={({pressed}) => [
        styles.base,
        styles[variant],
        pressed && !inactive ? styles.pressed : null,
        inactive ? styles.disabled : null,
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={colors.text} /> : null}
      <Text style={[styles.label, variant === 'secondary' ? styles.labelSecondary : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  primary: {backgroundColor: colors.accent, borderColor: colors.accent},
  secondary: {backgroundColor: colors.surfaceRaised, borderColor: colors.border},
  danger: {backgroundColor: 'transparent', borderColor: colors.danger},
  pressed: {opacity: 0.75},
  disabled: {opacity: 0.4},
  label: {...typography.body, color: '#101010', fontWeight: '700'},
  labelSecondary: {color: colors.text},
});
