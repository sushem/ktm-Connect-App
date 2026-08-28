import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';

import {Button} from '../components/Button';
import {Card} from '../components/Card';
import {OptionRow} from '../components/OptionRow';
import {Screen} from '../components/Screen';
import {StatusPill} from '../components/StatusPill';
import {Toggle} from '../components/Toggle';
import {guidanceView, TURN_ICONS, type TurnIcon} from '../protocol/ktm/messages';
import {bikeService} from '../services/BikeService';
import {useSession} from '../state/sessionStore';
import {useSettings} from '../state/settingsStore';
import {colors, radius, spacing, typography} from '../theme';

/**
 * The phone → bike direction: whatever you send here is drawn on the bike's
 * TFT display until something else replaces it.
 */
export function DisplayScreen() {
  const link = useSession(state => state.links.dashboard);
  const view = useSession(state => state.dashboardView);
  const mirror = useSettings(state => state.mirrorTelemetryToDashboard);
  const updateSettings = useSettings(state => state.update);

  const [road, setRoad] = useState('Grossglockner Road');
  const [turnMetres, setTurnMetres] = useState('350');
  const [remainingKm, setRemainingKm] = useState('42');
  const [icon, setIcon] = useState<TurnIcon>('QUITE_RIGHT');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connected = link.status === 'connected';

  const send = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Navigation"
      subtitle={link.deviceName ?? 'Dashboard not connected'}
      accessory={<StatusPill status={link.status} />}>
      {!connected ? (
        <Card>
          <Text style={styles.hint}>
            Connect the MY RIDE link on the Connect tab first. Until then these controls have
            nowhere to send to.
          </Text>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
        </Card>
      ) : null}

      <Card title="What the bike is showing" footnote={`Context: ${view.uiContext}`}>
        <View style={styles.preview}>
          <Text style={styles.previewLine}>
            {view.turnIcon ? `${view.turnIcon.replace(/_/g, ' ').toLowerCase()}` : '—'}
          </Text>
          <Text style={styles.previewBig}>
            {view.turnDist ? `${view.turnDist} ${view.turnDistUnit ?? ''}` : ''}
          </Text>
          <Text style={styles.previewLine}>{view.turnRoad ?? ''}</Text>
          <Text style={styles.previewMuted}>
            {[view.dist2Target, view.eta].filter(Boolean).join('   ·   ')}
          </Text>
          <Text style={styles.previewMuted}>{view.notificationText ?? ''}</Text>
        </View>
      </Card>

      <Card
        title="Turn-by-turn"
        footnote="The dashboard renders these fields itself — you send the values, it draws the arrow.">
        <OptionRow
          label="Manoeuvre"
          value={icon}
          onChange={setIcon}
          options={TURN_ICONS.map(value => ({
            value,
            label: value.replace(/_/g, ' ').toLowerCase(),
          }))}
        />
        <TextInput
          value={road}
          onChangeText={setRoad}
          placeholder="Road name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={32}
        />
        <View style={styles.row}>
          <TextInput
            value={turnMetres}
            onChangeText={setTurnMetres}
            keyboardType="number-pad"
            placeholder="Metres to turn"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.inputHalf]}
          />
          <TextInput
            value={remainingKm}
            onChangeText={setRemainingKm}
            keyboardType="number-pad"
            placeholder="km remaining"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.inputHalf]}
          />
        </View>
        <Button
          label="Send guidance"
          disabled={!connected}
          busy={busy}
          onPress={() =>
            void send(() => {
              const remainingM = number(remainingKm) * 1000;
              const speedKph = 60;
              return bikeService.showOnDashboard(
                guidanceView({
                  icon,
                  road: road.trim() || undefined,
                  distanceM: number(turnMetres),
                  remainingM,
                  // A rough arrival time so the ETA field has something real in it.
                  etaAt: Date.now() + (remainingM / 1000 / speedKph) * 3_600_000,
                }),
              );
            })
          }
        />
      </Card>

      <Card title="Live data on the bike">
        <Toggle
          label="Mirror speed and gear"
          hint="Sends the current speed and estimated gear to the dashboard once a second while both links are up."
          value={mirror}
          disabled={!connected}
          onChange={value => {
            updateSettings({mirrorTelemetryToDashboard: value});
            bikeService.syncMirroring();
          }}
        />
        <Button
          label="Restore the bike's own screen"
          variant="secondary"
          disabled={!connected}
          busy={busy}
          onPress={() => void send(() => bikeService.restoreDashboard())}
        />
      </Card>
    </Screen>
  );
}

function number(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

const styles = StyleSheet.create({
  hint: {...typography.body, color: colors.textMuted, lineHeight: 21},
  error: {...typography.body, color: colors.danger, lineHeight: 21},
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputHalf: {flex: 1},
  row: {flexDirection: 'row', gap: spacing.sm},
  preview: {
    backgroundColor: '#000',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 2,
    minHeight: 140,
    justifyContent: 'center',
  },
  previewLine: {...typography.body, color: colors.text},
  previewBig: {...typography.title, color: colors.accent, fontSize: 34},
  previewMuted: {...typography.label, color: colors.textMuted, fontWeight: '500'},
});
