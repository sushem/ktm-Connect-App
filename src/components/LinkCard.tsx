import React, {useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

import {Button} from './Button';
import {Card} from './Card';
import {StatusPill} from './StatusPill';
import type {LinkId} from '../core/types';
import type {BluetoothService} from '../protocol/ktm/services';
import {connectableServices} from '../protocol/ktm/services';
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
  /**
   * Offer an SDP lookup per device. Worth it for the dashboard link, where a
   * failed connect usually means the service is simply not there.
   */
  inspectable?: boolean;
}

type Inspection =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  | {state: 'done'; services: BluetoothService[]};

export function LinkCard({
  link,
  title,
  description,
  unavailableReason,
  scanLabel,
  inspectable,
}: LinkCardProps) {
  const state = useSession(s => s.links[link]);
  const devices = useSession(s => s.devices[link]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inspections, setInspections] = useState<Record<string, Inspection>>({});

  const scanning = state.status === 'scanning';
  const connected = state.status === 'connected';

  const scan = async () => {
    try {
      await bikeService.scan(link);
    } catch {
      // The failure is already on the card via the link's status message.
    }
  };

  const connect = async (deviceId: string, serviceUuid?: string) => {
    setBusyId(deviceId);
    try {
      await bikeService.connect(link, deviceId, serviceUuid);
    } catch {
      // Same here: `state.message` carries the reason.
    } finally {
      setBusyId(null);
    }
  };

  const inspect = async (deviceId: string) => {
    setInspections(current => ({...current, [deviceId]: {state: 'loading'}}));
    try {
      const services = await bikeService.discoverServices(deviceId);
      setInspections(current => ({...current, [deviceId]: {state: 'done', services}}));
    } catch (error) {
      setInspections(current => ({
        ...current,
        [deviceId]: {state: 'error', message: error instanceof Error ? error.message : String(error)},
      }));
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
                  <View key={device.id} style={styles.device}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void connect(device.id)}
                      disabled={busyId != null}
                      style={styles.deviceRow}>
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

                    {inspectable ? (
                      <ServicePanel
                        inspection={inspections[device.id]}
                        onInspect={() => void inspect(device.id)}
                        onConnect={uuid => void connect(device.id, uuid)}
                      />
                    ) : null}
                  </View>
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

/** What the device told us over SDP, and what can be done about it. */
function ServicePanel({
  inspection,
  onInspect,
  onConnect,
}: {
  inspection?: Inspection;
  onInspect: () => void;
  onConnect: (uuid: string) => void;
}) {
  if (!inspection) {
    return (
      <Pressable accessibilityRole="button" onPress={onInspect} style={styles.inspectRow}>
        <Text style={styles.inspectLabel}>What does this device offer?</Text>
      </Pressable>
    );
  }

  if (inspection.state === 'loading') {
    return (
      <View style={styles.inspectRow}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={styles.serviceNote}>Asking the device…</Text>
      </View>
    );
  }

  if (inspection.state === 'error') {
    return (
      <View style={styles.inspectRow}>
        <Text style={styles.error}>{inspection.message}</Text>
      </View>
    );
  }

  const {services} = inspection;
  const myRide = services.some(service => service.isMyRide);
  const worthTrying = connectableServices(services.map(service => service.uuid));

  return (
    <View style={styles.services}>
      {services.length === 0 ? (
        <Text style={styles.serviceNote}>
          The device advertised no services. Unpair and pair it again, with the ignition on.
        </Text>
      ) : (
        <>
          <Text style={myRide ? styles.serviceGood : styles.serviceNote}>
            {myRide
              ? 'MY RIDE is there — this dashboard can take a connection.'
              : 'No MY RIDE service on this device. On many models it is an extra that a KTM dealer has to activate, and without it there is nothing here to connect to.'}
          </Text>
          {services.map(service => (
            <View key={service.uuid} style={styles.serviceRow}>
              <View style={styles.serviceText}>
                <Text style={service.isMyRide ? styles.serviceGood : styles.serviceLabel}>
                  {service.label}
                </Text>
                <Text style={styles.serviceUuid}>{service.uuid}</Text>
              </View>
              {worthTrying.some(candidate => candidate.uuid === service.uuid) ? (
                <Pressable accessibilityRole="button" onPress={() => onConnect(service.uuid)}>
                  <Text style={styles.connectHint}>Try</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  message: {...typography.body, color: colors.textMuted, lineHeight: 20},
  error: {...typography.body, color: colors.danger, lineHeight: 20},
  unavailable: {...typography.body, color: colors.textMuted, lineHeight: 20},
  list: {gap: spacing.sm},
  device: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  connectedText: {flexShrink: 1, gap: 2},
  deviceName: {...typography.body, color: colors.text},
  deviceMeta: {...typography.label, color: colors.textMuted, fontWeight: '500'},
  connectHint: {...typography.label, color: colors.accent},
  empty: {...typography.body, color: colors.textMuted},
  inspectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  inspectLabel: {...typography.label, color: colors.textMuted, textDecorationLine: 'underline'},
  services: {paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm},
  serviceNote: {...typography.label, color: colors.textMuted, fontWeight: '500', lineHeight: 17},
  serviceGood: {...typography.label, color: colors.success, lineHeight: 17},
  serviceRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
  serviceText: {flexShrink: 1},
  serviceLabel: {...typography.label, color: colors.text, fontWeight: '500'},
  serviceUuid: {...typography.label, color: colors.textMuted, fontWeight: '400', fontSize: 10},
});
