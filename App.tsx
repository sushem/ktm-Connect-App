import React, {useEffect, useState} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';

import {ConnectScreen} from './src/screens/ConnectScreen';
import {DiagnosticsScreen} from './src/screens/DiagnosticsScreen';
import {DisplayScreen} from './src/screens/DisplayScreen';
import {MessageScreen} from './src/screens/MessageScreen';
import {RideScreen} from './src/screens/RideScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {confirmBoot} from './src/services/updates';
import {useSession} from './src/state/sessionStore';
import {useSettings} from './src/state/settingsStore';
import {colors, spacing, typography} from './src/theme';

type TabId = 'ride' | 'connect' | 'message' | 'display' | 'diagnostics' | 'settings';

const TABS: Array<{id: TabId; label: string; render: () => React.ReactElement}> = [
  {id: 'ride', label: 'Ride', render: () => <RideScreen />},
  {id: 'connect', label: 'Connect', render: () => <ConnectScreen />},
  {id: 'message', label: 'Message', render: () => <MessageScreen />},
  {id: 'display', label: 'Nav', render: () => <DisplayScreen />},
  {id: 'diagnostics', label: 'Codes', render: () => <DiagnosticsScreen />},
  {id: 'settings', label: 'Setup', render: () => <SettingsScreen />},
];

function Shell() {
  const [tab, setTab] = useState<TabId>('ride');
  const insets = useSafeAreaInsets();
  const hydrate = useSettings(state => state.hydrate);
  const links = useSession(state => state.links);

  useEffect(() => {
    void hydrate();
    // Getting this far means the bundle runs. Until this is said, a freshly
    // downloaded one is on trial and is discarded if the app keeps failing.
    void confirmBoot();
  }, [hydrate]);

  const active = TABS.find(entry => entry.id === tab) ?? TABS[0];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.content}>{active.render()}</View>
      <View style={[styles.tabBar, {paddingBottom: Math.max(insets.bottom, spacing.sm)}]}>
        {TABS.map(entry => {
          const selected = entry.id === tab;
          // A dot on the tab that owns a live link saves a trip to Connect.
          const live =
            (entry.id === 'ride' && links.telemetry.status === 'connected') ||
            ((entry.id === 'display' || entry.id === 'message') &&
              links.dashboard.status === 'connected');
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="tab"
              accessibilityState={{selected}}
              accessibilityLabel={entry.label}
              onPress={() => setTab(entry.id)}
              style={styles.tab}>
              <Text style={[styles.tabLabel, selected ? styles.tabLabelActive : null]}>
                {entry.label}
              </Text>
              <View style={[styles.indicator, selected ? styles.indicatorActive : null]} />
              {live ? <View style={styles.liveDot} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  content: {flex: 1},
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  tab: {flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.xs},
  tabLabel: {...typography.label, color: colors.textMuted},
  tabLabelActive: {color: colors.text},
  indicator: {height: 2, width: 22, borderRadius: 2, backgroundColor: 'transparent'},
  indicatorActive: {backgroundColor: colors.accent},
  liveDot: {
    position: 'absolute',
    top: 2,
    right: '28%',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
});
