import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {Button} from '../components/Button';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {bikeService} from '../services/BikeService';
import {useSession} from '../state/sessionStore';
import {colors, radius, spacing, typography} from '../theme';

/** Stored trouble codes, plus the running conversation with both links. */
export function DiagnosticsScreen() {
  const codes = useSession(state => state.codes);
  const log = useSession(state => state.log);
  const clearLog = useSession(state => state.clearLog);
  const telemetryLink = useSession(state => state.links.telemetry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      await bikeService.readDiagnosticCodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Diagnostics" subtitle="Stored codes and link activity">
      <Card
        title="Trouble codes"
        footnote="Reads stored codes (service 03). Clearing codes is deliberately not offered — it also wipes the ECU's readiness data, which a workshop will want.">
        <Button
          label="Read stored codes"
          busy={busy}
          disabled={telemetryLink.status !== 'connected'}
          onPress={() => void read()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {codes.length === 0 ? (
          <Text style={styles.muted}>No codes read yet.</Text>
        ) : (
          <View style={styles.codes}>
            {codes.map(code => (
              <View key={code.code} style={styles.code}>
                <Text style={styles.codeText}>{code.code}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card
        title="Link log"
        accessory={<Button label="Clear" variant="secondary" onPress={clearLog} />}>
        {log.length === 0 ? (
          <Text style={styles.muted}>Nothing logged yet.</Text>
        ) : (
          <View style={styles.log}>
            {log
              .slice()
              .reverse()
              .map((line, index) => (
                <Text key={`${line.at}-${index}`} style={styles.logLine} numberOfLines={3}>
                  <Text style={styles.logSource}>{line.source}</Text>  {line.text}
                </Text>
              ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: {...typography.body, color: colors.textMuted},
  error: {...typography.body, color: colors.danger, lineHeight: 21},
  codes: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  code: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  codeText: {...typography.body, color: colors.danger, fontWeight: '700'},
  log: {gap: spacing.xs},
  logLine: {...typography.label, color: colors.textMuted, fontWeight: '500', lineHeight: 17},
  logSource: {color: colors.accent},
});
