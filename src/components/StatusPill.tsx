import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import type {LinkStatus} from '../core/types';
import {colors, radius, spacing, typography} from '../theme';

const TONE: Record<LinkStatus, {color: string; label: string}> = {
  connected: {color: colors.success, label: 'Connected'},
  connecting: {color: colors.warning, label: 'Connecting'},
  scanning: {color: colors.warning, label: 'Scanning'},
  idle: {color: colors.textMuted, label: 'Not connected'},
  error: {color: colors.danger, label: 'Error'},
  unavailable: {color: colors.textMuted, label: 'Unavailable'},
  unsupported: {color: colors.textMuted, label: 'Unsupported'},
};

export function StatusPill({status, label}: {status: LinkStatus; label?: string}) {
  const tone = TONE[status];
  return (
    <View style={[styles.pill, {borderColor: tone.color}]}>
      <View style={[styles.dot, {backgroundColor: tone.color}]} />
      <Text style={[styles.label, {color: tone.color}]}>{label ?? tone.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: {width: 7, height: 7, borderRadius: 4},
  label: {...typography.label},
});
