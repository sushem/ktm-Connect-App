import React, {useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

import {Button} from './Button';
import {Card} from './Card';
import {StatusPill} from './StatusPill';
import type {LinkId} from '../core/types';
import {bikeService} from '../services/BikeService';
import {useSession} from '../state/sessionStore';
import {colors, radius, spacing, typography} from '../theme';

interface LinkCardProps {
  link: LinkId;
  title: string;
  description: string;
  /** Shown instead of the controls when the link cannot run here. */
  unavailableReason?: string;
  scanLabel?: string;
}

export function LinkCard({link, title, description, unavailableReason, scanLabel}: LinkCardProps) {
  const state = useSession(s => s.links[link]);
  const devices = useSession(s => s.devices[link]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const scanning = state.status === 'scanning';
  const connected = state.status === 'connected';

  const scan = async () => {
    try {
      await bikeService.scan(link);
    } catch {
      // The failure is already on the card via the link's status message.
    }
  };

  const connect = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      await bikeService.connect(link, deviceId);
    } catch {
      // Same here: `state.message` carries the reason.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title={title}
      accessory={<StatusPill status={unavailableReason ? 'unsupported' : state.status} />}
      footnote={description}>
      {unavailableReason ? (
        <Text style={styles.unavailable}>{unavailableReason}</Text>
      ) : (
        <>
          {state.message ? (
            <Text style={[styles.message, state.status === 'error' ? styles.error : null]}>
              {state.message}
            </Text>
          ) : null}

          {connected ? (
            <View style={styles.connectedRow}>
              <View style={styles.connectedText}>
                <Text style={styles.deviceName}>{state.deviceName ?? state.deviceId}</Text>
                <Text style={styles.deviceMeta}>{state.deviceId}</Text>
              </View>
              <Button
                label="Disconnect"
                variant="danger"
                onPress={() => void bikeService.disconnect(link)}
              />
            </View>
          ) : (
            <>
              <Button
                label={scanning ? 'Searching…' : (scanLabel ?? 'Search for devices')}
                onPress={() => void scan()}
                busy={scanning}
              />
              <View style={styles.list}>
                {devices.map(device => (
                  <Pressable
                    key={device.id}
                    accessibilityRole="button"
                    onPress={() => void connect(device.id)}
                    disabled={busyId != null}
                    style={({pressed}) => [styles.device, pressed ? styles.devicePressed : null]}>
                    <View style={styles.connectedText}>
                      <Text style={styles.deviceName}>
                        {device.name}
                        {device.likelyMatch ? '  ★' : ''}
                      </Text>
                      <Text style={styles.deviceMeta}>
                        {device.id}
                        {device.rssi != null ? `  ·  ${device.rssi} dBm` : ''}
                      </Text>
                    </View>
                    {busyId === device.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={styles.connectHint}>Connect</Text>
                    )}
                  </Pressable>
                ))}
                {!scanning && devices.length === 0 ? (
                  <Text style={styles.empty}>No devices listed yet.</Text>
                ) : null}
              </View>
            </>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  message: {...typography.body, color: colors.textMuted, lineHeight: 20},
  error: {color: colors.danger},
  unavailable: {...typography.body, color: colors.textMuted, lineHeight: 20},
  list: {gap: spacing.sm},
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  devicePressed: {borderColor: colors.accent},
  connectedRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
  connectedText: {flexShrink: 1, gap: 2},
  deviceName: {...typography.body, color: colors.text},
  deviceMeta: {...typography.label, color: colors.textMuted, fontWeight: '500'},
  connectHint: {...typography.label, color: colors.accent},
  empty: {...typography.body, color: colors.textMuted},
});
