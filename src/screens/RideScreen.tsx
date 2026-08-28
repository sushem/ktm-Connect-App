import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {Card} from '../components/Card';
import {Gauge} from '../components/Gauge';
import {StatTile} from '../components/StatTile';
import {Screen} from '../components/Screen';
import {StatusPill} from '../components/StatusPill';
import {useSession} from '../state/sessionStore';
import {useSettings} from '../state/settingsStore';
import {colors, spacing, typography} from '../theme';
import {
  decimals,
  distance,
  distanceUnit,
  duration,
  integer,
  speed,
  speedUnit,
  temperature,
  temperatureUnit,
} from '../utils/units';

/** Coolant temperatures beyond these are worth shouting about. */
const COOLANT_WARNING_C = 105;
const COOLANT_DANGER_C = 115;

export function RideScreen() {
  const telemetry = useSession(state => state.telemetry);
  const link = useSession(state => state.links.telemetry);
  const trip = useSession(state => state.trip);
  const units = useSettings(state => state.units);
  const profile = useSettings(state => state.profile());

  const connected = link.status === 'connected';
  const stale = telemetry.updatedAt != null && Date.now() - telemetry.updatedAt > 5000;

  return (
    <Screen
      title="Ride"
      subtitle={link.deviceName ?? 'No adapter connected'}
      accessory={<StatusPill status={link.status} />}>
      {!connected ? (
        <Card>
          <Text style={styles.emptyTitle}>Nothing to show yet</Text>
          <Text style={styles.emptyBody}>
            Plug a BLE OBD-II adapter into the bike's diagnostic port and connect it on the Connect
            tab. No adapter to hand? Turn on demo mode there and the app will drive itself.
          </Text>
        </Card>
      ) : null}

      <Gauge
        label="engine speed"
        value={telemetry.rpm}
        max={profile.maxRpm}
        redline={profile.redlineRpm}
        tickEvery={1000}
        centerValue={speed(telemetry.speedKph, units)}
        centerUnit={speedUnit(units)}
        centerCaption={telemetry.gear ? `gear ${telemetry.gear}` : undefined}
      />

      <View style={styles.rpmRow}>
        <Text style={styles.rpmValue}>{integer(telemetry.rpm)}</Text>
        <Text style={styles.rpmUnit}>rpm</Text>
        {stale ? <Text style={styles.staleFlag}>signal stalled</Text> : null}
      </View>

      <View style={styles.tiles}>
        <StatTile
          label="Coolant"
          value={temperature(telemetry.coolantTempC, units)}
          unit={temperatureUnit(units)}
          tone={coolantTone(telemetry.coolantTempC)}
        />
        <StatTile
          label="Oil"
          value={temperature(telemetry.oilTempC, units)}
          unit={temperatureUnit(units)}
        />
        <StatTile
          label="Intake"
          value={temperature(telemetry.intakeTempC, units)}
          unit={temperatureUnit(units)}
        />
        <StatTile label="Throttle" value={integer(telemetry.throttlePct)} unit="%" />
        <StatTile label="Load" value={integer(telemetry.enginePct)} unit="%" />
        <StatTile
          label="Battery"
          value={decimals(telemetry.batteryVolts, 1)}
          unit="V"
          tone={telemetry.batteryVolts != null && telemetry.batteryVolts < 12 ? 'warning' : 'normal'}
        />
        <StatTile label="Fuel" value={integer(telemetry.fuelLevelPct)} unit="%" />
        <StatTile
          label="Ambient"
          value={temperature(telemetry.ambientTempC, units)}
          unit={temperatureUnit(units)}
        />
      </View>

      {trip ? (
        <Card title="This session">
          <View style={styles.tiles}>
            <StatTile
              label="Distance"
              value={distance(trip.distanceKm, units)}
              unit={distanceUnit(units)}
            />
            <StatTile
              label="Top speed"
              value={speed(trip.maxSpeedKph, units)}
              unit={speedUnit(units)}
            />
            <StatTile label="Peak rpm" value={integer(trip.maxRpm)} />
            <StatTile label="Moving" value={duration(trip.movingMs)} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function coolantTone(value?: number): 'normal' | 'warning' | 'danger' {
  if (value == null) {
    return 'normal';
  }
  if (value >= COOLANT_DANGER_C) {
    return 'danger';
  }
  return value >= COOLANT_WARNING_C ? 'warning' : 'normal';
}

const styles = StyleSheet.create({
  rpmRow: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm},
  rpmValue: {...typography.title, color: colors.accent},
  rpmUnit: {...typography.label, color: colors.textMuted},
  staleFlag: {...typography.label, color: colors.warning, marginLeft: spacing.sm},
  tiles: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  emptyTitle: {...typography.body, color: colors.text, fontWeight: '700'},
  emptyBody: {...typography.body, color: colors.textMuted, lineHeight: 21},
});
