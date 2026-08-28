import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {Button} from '../components/Button';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {StatusPill} from '../components/StatusPill';
import {bikeService} from '../services/BikeService';
import {useSession} from '../state/sessionStore';
import {colors, radius, spacing, typography} from '../theme';

/**
 * The dashboard's notification line is short and the font is wide, so anything
 * past this is likely to be clipped on the bike.
 */
const MAX_LENGTH = 64;

/** One tap each, for the things riders actually want to say. */
const PRESETS = ['Fuel stop next', 'Following you', 'Slowing down', 'Break in 10 min'];

/**
 * Type a message, send it, and it stays on the bike's TFT screen until it is
 * replaced or the screen is handed back.
 */
export function MessageScreen() {
  const link = useSession(state => state.links.dashboard);
  const shown = useSession(state => state.dashboardView.notificationText);
  const recent = useSession(state => state.sentMessages);

  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connected = link.status === 'connected';
  const trimmed = text.trim();
  const canSend = connected && trimmed.length > 0 && !busy;

  const send = async (value: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await bikeService.sendMessage(value);
      setStatus(`Showing “${value.trim()}” on the bike`);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await bikeService.restoreDashboard();
      setStatus('Screen handed back to the bike');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Message"
      subtitle={link.deviceName ?? 'Dashboard not connected'}
      accessory={<StatusPill status={link.status} />}>
      <Card
        title="Send to the bike's screen"
        footnote={`Up to ${MAX_LENGTH} characters. Longer messages may be clipped by the display.`}>
        <TextInput
          value={text}
          onChangeText={value => {
            setText(value);
            setStatus(null);
          }}
          placeholder="What should the bike show?"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={MAX_LENGTH}
          multiline
          returnKeyType="send"
          onSubmitEditing={() => canSend && void send(trimmed)}
          editable={!busy}
          accessibilityLabel="Message to show on the bike's display"
        />
        <View style={styles.counterRow}>
          <Text style={styles.counter}>
            {text.length}/{MAX_LENGTH}
          </Text>
          {text.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setText('')}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <Button
          label="Show on bike screen"
          onPress={() => void send(trimmed)}
          disabled={!canSend}
          busy={busy}
        />

        {!connected ? (
          <Text style={styles.hint}>
            The dashboard link is not connected. Open the Connect tab and connect it — or turn on
            demo mode there to try this against the simulator.
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {status && !error ? <Text style={styles.status}>{status}</Text> : null}
      </Card>

      <Card title="On the bike now">
        <View style={styles.preview}>
          <Text style={shown ? styles.previewText : styles.previewEmpty}>
            {shown && shown.length > 0 ? shown : 'Nothing — the bike is showing its own screen'}
          </Text>
        </View>
        <Button
          label="Clear the bike's screen"
          variant="secondary"
          onPress={() => void clear()}
          disabled={!connected || busy}
        />
      </Card>

      <Card title="Quick messages">
        <View style={styles.chips}>
          {PRESETS.map(preset => (
            <Pressable
              key={preset}
              accessibilityRole="button"
              onPress={() => setText(preset)}
              style={({pressed}) => [styles.chip, pressed ? styles.chipPressed : null]}>
              <Text style={styles.chipText}>{preset}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {recent.length > 0 ? (
        <Card title="Recently sent" footnote="Tap to send again.">
          <View style={styles.recent}>
            {recent.map(message => (
              <Pressable
                key={message}
                accessibilityRole="button"
                disabled={!connected || busy}
                onPress={() => void send(message)}
                style={({pressed}) => [styles.recentRow, pressed ? styles.chipPressed : null]}>
                <Text style={styles.recentText} numberOfLines={1}>
                  {message}
                </Text>
                <Text style={styles.recentAction}>{connected ? 'Send' : ''}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 84,
    textAlignVertical: 'top',
  },
  counterRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  counter: {...typography.label, color: colors.textMuted, fontWeight: '500'},
  clearText: {...typography.label, color: colors.accent},
  hint: {...typography.body, color: colors.textMuted, lineHeight: 21},
  error: {...typography.body, color: colors.danger, lineHeight: 21},
  status: {...typography.body, color: colors.success, lineHeight: 21},
  preview: {
    backgroundColor: '#000',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    minHeight: 84,
    justifyContent: 'center',
  },
  previewText: {...typography.title, color: colors.accent, fontSize: 20},
  previewEmpty: {...typography.body, color: colors.textMuted},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipPressed: {borderColor: colors.accent},
  chipText: {...typography.label, color: colors.text},
  recent: {gap: spacing.sm},
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  recentText: {...typography.body, color: colors.text, flexShrink: 1},
  recentAction: {...typography.label, color: colors.accent},
});
