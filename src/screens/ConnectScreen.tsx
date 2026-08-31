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
  const protocol = useSettings(state => state.dashboardProtocol);
  const update = useSettings(state => state.update);
  const gen3 = protocol === 'gen3';
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
        title={gen3 ? 'Phone → bike  ·  Gen-3 dashboard' : 'Phone → bike  ·  MY RIDE'}
        scanLabel={gen3 ? 'Scan for the bike' : 'List paired devices'}
        inspectable={!gen3}
        description={
          gen3
            ? "The bike's TFT display over BLE. Turn the ignition on and scan. Devices already paired with this phone are listed too, because a dashboard connected for music and calls often stops advertising — pick the bike either way. The first connection makes it ask you to confirm this phone, so accept that on the dashboard."
            : "The bike's TFT display. Pair the bike in your phone's Bluetooth settings first — it is not discoverable from here. MY RIDE is an optional extra on many models: tap a device to see whether yours offers it."
        }
        unavailableReason={
          dashboardSupported
            ? undefined
            : Platform.OS === 'ios'
              ? 'The older MY RIDE link needs a Bluetooth Classic serial port, which iOS reserves for MFi accessories. If your bike is a 2020-on model, switch to the Gen-3 protocol on the Setup tab — that one works here.'
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
          {gen3
            ? '4. For the display link, turn the ignition on and scan. The list starts with the devices already paired to this phone and fills in with whatever is advertising nearby — an unnamed entry can still be the bike. Pick yours, and accept the confirmation prompt that appears on the dashboard.'
            : "4. For the display link, pair the bike over Bluetooth in the phone's system settings, then come back and list paired devices. Sitting on the bike's pairing screen is not enough — the phone has to finish bonding."}
        </Text>
        <Text style={styles.step}>
          {gen3
            ? '5. Bike not listed at all? Pair it once in the phone\'s Bluetooth settings — a bonded dashboard is listed here even when it is not advertising. If it is listed but will not connect, check the protocol on the Setup tab: Gen-3 covers the 2020-on bikes, older ones need the MY RIDE setting.'
            : '5. If connecting fails, tap "What does this device offer?" under the device. MY RIDE is optional on models like the 390 Adventure and is activated by a dealer — but a 2020-on bike is more likely a Gen-3 dashboard, which is a different protocol entirely. Switch it on the Setup tab.'}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: {...typography.body, color: colors.textMuted, lineHeight: 21},
});
