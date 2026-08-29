import React from 'react';
import {Linking, Platform, StyleSheet, Text} from 'react-native';

import {Card} from '../components/Card';
import {OptionRow} from '../components/OptionRow';
import {Screen} from '../components/Screen';
import {Toggle} from '../components/Toggle';
import {bikeService} from '../services/BikeService';
import {useSettings} from '../state/settingsStore';
import {colors, typography} from '../theme';
import {BIKE_PROFILES} from '../utils/gear';

export function SettingsScreen() {
  const settings = useSettings();

  return (
    <Screen title="Settings">
      <Card title="Units">
        <OptionRow
          label="Speed, distance and temperature"
          value={settings.units}
          onChange={units => settings.update({units})}
          options={[
            {value: 'metric', label: 'km/h · °C'},
            {value: 'imperial', label: 'mph · °F'},
          ]}
        />
      </Card>

      <Card
        title="Bike"
        footnote="The gear readout compares engine speed against road speed, so it needs the bike's gearing. Pick the closest profile — if the indicated gear is consistently one out, try a neighbouring one.">
        <OptionRow
          label="Gearing profile"
          value={settings.bikeProfileId}
          onChange={bikeProfileId => settings.update({bikeProfileId})}
          options={BIKE_PROFILES.map(profile => ({value: profile.id, label: profile.name}))}
        />
      </Card>

      <Card
        title="Polling"
        footnote="How long to wait between OBD-II poll cycles. Shorter is more responsive but asks more of cheap adapters; if readings start dropping out, back off.">
        <OptionRow
          label="Interval"
          value={settings.pollIntervalMs}
          onChange={pollIntervalMs => settings.update({pollIntervalMs})}
          options={[
            {value: 60, label: 'Fast'},
            {value: 120, label: 'Normal'},
            {value: 300, label: 'Gentle'},
          ]}
        />
      </Card>

      <Card
        title="Dashboard"
        footnote="Gen-3 covers the 2020-on bikes, which speak BLE and prompt on the dash to confirm a new phone. Older MY RIDE dashboards use a Bluetooth Classic serial link, which only Android can open.">
        <OptionRow
          label="Which dashboard the bike has"
          value={settings.dashboardProtocol}
          onChange={dashboardProtocol => {
            void bikeService.disconnect('dashboard');
            settings.update({dashboardProtocol});
          }}
          options={[
            {value: 'gen3', label: 'Gen-3 (2020 on)'},
            {value: 'legacy', label: 'Older MY RIDE'},
          ]}
        />
      </Card>

      <Card title="While riding">
        <Toggle
          label="Mirror speed and gear to the bike"
          value={settings.mirrorTelemetryToDashboard}
          onChange={value => {
            settings.update({mirrorTelemetryToDashboard: value});
            bikeService.syncMirroring();
          }}
        />
        <Toggle
          label="Send the opening frames on connect"
          hint="Off means the app opens the link and only listens. Useful on a dashboard that does not recognise what we send, to see whether it says anything first."
          value={settings.sendHandshake}
          onChange={sendHandshake => settings.update({sendHandshake})}
        />
        <Toggle
          label="Demo mode"
          hint="Simulated bike and dashboard, for trying the app without hardware."
          value={settings.demoMode}
          onChange={value => {
            void bikeService.disconnect('telemetry');
            void bikeService.disconnect('dashboard');
            settings.update({demoMode: value});
          }}
        />
      </Card>

      <Card title="About">
        <Text style={styles.body}>
          KTM Connect reads engine data through a BLE OBD-II adapter and writes to the bike's TFT
          display over the MY RIDE serial link. It is an independent project, not affiliated with or
          endorsed by KTM, and the display protocol comes from community reverse engineering rather
          than a published specification.
        </Text>
        <Text style={styles.body}>
          Running on {Platform.OS === 'ios' ? 'iOS' : 'Android'}. The display link needs Bluetooth
          Classic, which only Android exposes to ordinary apps.
        </Text>
        <Text
          style={styles.link}
          accessibilityRole="link"
          onPress={() => void Linking.openURL('https://github.com/sushem/ktm-connect-app')}>
          github.com/sushem/ktm-connect-app
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {...typography.body, color: colors.textMuted, lineHeight: 21},
  link: {...typography.body, color: colors.accent},
});
