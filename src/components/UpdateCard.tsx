import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {Button} from './Button';
import {Card} from './Card';
import {
  applyUpdate,
  checkForUpdate,
  currentState,
  revertToPackagedBundle,
  type UpdateDecision,
  type UpdateState,
} from '../services/updates';
import {colors, spacing, typography} from '../theme';

/**
 * Over-the-air updates, from the rider's side.
 *
 * The distinction that matters here is between a bundle this app can load and
 * one that needs a newer build — the card says which, because "update failed"
 * with no explanation is the thing that sends someone to the Actions tab.
 */
export function UpdateCard() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [decision, setDecision] = useState<UpdateDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await currentState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setDecision(await checkForUpdate());
    } finally {
      setBusy(false);
    }
  };

  const install = async (found: Extract<UpdateDecision, {action: 'update'}>) => {
    setBusy(true);
    setMessage(null);
    try {
      await applyUpdate(found.manifest);
      setDecision(null);
      setMessage(`Version ${found.manifest.version} is ready. Close the app and open it again.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    setBusy(true);
    try {
      await revertToPackagedBundle();
      setMessage('Back to the version that came with the app. Close it and open it again.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (state && !state.supported) {
    return (
      <Card title="Updates">
        <Text style={styles.muted}>
          This build cannot update itself. That is expected on iOS, where the updater is not
          implemented.
        </Text>
      </Card>
    );
  }

  return (
    <Card
      title="Updates"
      footnote="Fixes to the app's own logic arrive this way, without reinstalling. Changes to the Bluetooth plumbing itself still need a new build — the app will say so rather than downloading something it cannot run.">
      <View style={styles.row}>
        <Text style={styles.label}>Running</Text>
        <Text style={styles.value}>
          {state?.activeVersion ? state.activeVersion : 'the version that came with the app'}
        </Text>
      </View>
      {state?.pendingVersion ? (
        <View style={styles.row}>
          <Text style={styles.label}>Waiting for a restart</Text>
          <Text style={styles.value}>{state.pendingVersion}</Text>
        </View>
      ) : null}

      <Button label="Check for updates" onPress={() => void check()} busy={busy} />

      {decision?.action === 'update' ? (
        <>
          <Text style={styles.available}>
            Version {decision.manifest.version} is available.
            {decision.manifest.notes ? ` ${decision.manifest.notes}` : ''}
          </Text>
          <Button label="Download and install" onPress={() => void install(decision)} busy={busy} />
        </>
      ) : null}

      {decision?.action === 'up-to-date' ? (
        <Text style={styles.muted}>Already up to date.</Text>
      ) : null}

      {decision?.action === 'needs-app-update' ? (
        <Text style={styles.warning}>
          Version {decision.version} needs a newer build of the app than this one — it uses
          Bluetooth code that only ships in the APK. Install the latest release instead.
        </Text>
      ) : null}

      {decision?.action === 'unusable' ? (
        <Text style={styles.warning}>{decision.reason}</Text>
      ) : null}

      {message ? <Text style={styles.muted}>{message}</Text> : null}

      {state?.activeVersion || state?.pendingVersion ? (
        <Button
          label="Go back to the packaged version"
          variant="secondary"
          onPress={() => void revert()}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md},
  label: {...typography.label, color: colors.textMuted},
  value: {...typography.label, color: colors.text, flexShrink: 1, textAlign: 'right'},
  muted: {...typography.body, color: colors.textMuted, lineHeight: 21},
  warning: {...typography.body, color: colors.warning, lineHeight: 21},
  available: {...typography.body, color: colors.success, lineHeight: 21},
});
