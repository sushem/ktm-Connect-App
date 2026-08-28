import React, {type PropsWithChildren} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {colors, spacing, typography} from '../theme';

interface ScreenProps {
  title: string;
  subtitle?: string;
  /** Right-hand element in the header, usually a status pill. */
  accessory?: React.ReactNode;
  scroll?: boolean;
}

export function Screen({
  title,
  subtitle,
  accessory,
  scroll = true,
  children,
}: PropsWithChildren<ScreenProps>) {
  const insets = useSafeAreaInsets();
  const body = <View style={styles.body}>{children}</View>;

  return (
    <View style={[styles.container, {paddingTop: insets.top + spacing.sm}]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {accessory}
      </View>
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: {flexShrink: 1},
  title: {...typography.title, color: colors.text},
  subtitle: {...typography.label, color: colors.textMuted, marginTop: 2},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: spacing.xxl},
  body: {paddingHorizontal: spacing.lg, gap: spacing.md},
});
