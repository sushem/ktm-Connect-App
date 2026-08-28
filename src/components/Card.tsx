import React, {type PropsWithChildren} from 'react';
import {StyleSheet, Text, View, type ViewStyle} from 'react-native';

import {colors, radius, spacing, typography} from '../theme';

interface CardProps {
  title?: string;
  footnote?: string;
  accessory?: React.ReactNode;
  style?: ViewStyle;
}

export function Card({title, footnote, accessory, style, children}: PropsWithChildren<CardProps>) {
  return (
    <View style={[styles.card, style]}>
      {title || accessory ? (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title.toUpperCase()}</Text> : <View />}
          {accessory}
        </View>
      ) : null}
      {children}
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  title: {...typography.heading, color: colors.textMuted, fontSize: 12},
  footnote: {...typography.label, color: colors.textMuted, fontWeight: '500', lineHeight: 17},
});
