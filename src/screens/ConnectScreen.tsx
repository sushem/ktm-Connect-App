import React from 'react';
import {Platform, StyleSheet, Text} from 'react-native';

import {Card} from '../components/Card';
import {LinkCard} from '../components/LinkCard';
import {Screen} from '../components/Screen';
import {Toggle} from '../components/Toggle';
import {bikeService} from '../services/BikeService';
import {useSettings} from '../state/settingsStore';
import {colors, typography} from '../theme';

export function ConnectScreen() {
  const demoMode = useSettings(state => state.demoMode);
  const update = useSettings(state => state.update);
  const dashboardSupported = bikeService.dashboardSupported() || demoMode;

  return (
    <Screen title="Connect" subtitle="Two independent Bluetooth links">
      <Card title="Demo mode">
        <Toggle
          label="Use the built-in simulator"
          hint="Runs the whole app against a fake ELM327 and a fake dashboard, so you can try it without the bike."
          value={demoMode}
          onChange={value => {
            void bikeService.disconnect('telemetry');
            void bikeService.disconnect('dashboard');
            update({demoMode: value});
          }}
        />
      </Card>

      <LinkCard
        link="telemetry"
        title="Bike → phone  ·  OBD-II"
        scanLabel="Scan for adapters"
        description="A BLE OBD-II adapter on the bike's diagnostic port. Engine data appears on the Ride tab. Adapters whose name looks right are marked ★."
      />

      <LinkCard
        link="dashboard"
        title="Phone → bike  ·  MY RIDE"
        scanLabel="List paired devices"
        description="The bike's TFT display. Pair the bike in your phone's Bluetooth settings first — it is not discoverable from here."
        unavailableReason={
          dashboardSupported
            ? undefined
            : Platform.OS === 'ios'
              ? 'iOS reserves Bluetooth Classic serial ports for MFi-licensed accessories, so an app cannot open the MY RIDE link. Everything on the Ride tab still works; the Display tab needs an Android phone.'
              : 'This build does not include the native MY RIDE module.'
        }
      />

      <Card title="Getting connected">
        <Text style={styles.step}>
          1. Plug the adapter into the diagnostic port. On most KTMs that is a 6-pin connector under
          the seat, and it needs a 6-pin to OBD-II lead.
        </Text>
        <Text style={styles.step}>2. Turn the ignition on — the ECU only answers when it is awake.</Text>
        <Text style={styles.step}>
          3. Scan above and connect. The first connection probes which parameters your ECU
          answers; anything it refuses is dropped from the poll loop.
        </Text>
        <Text style={styles.step}>
          4. For the display link, pair the bike over Bluetooth in the phone's system settings and
          switch MY RIDE on in the bike's menu, then come back and list paired devices.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: {...typography.body, color: colors.textMuted, lineHeight: 21},
});
