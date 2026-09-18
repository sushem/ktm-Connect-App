import type { DiscoveredDevice } from '../core/types';

/**
 * A bidirectional byte pipe to a device. Both the BLE OBD adapter and the
 * KTM MY RIDE RFCOMM socket are modelled this way, so the protocol code above
 * never has to care which radio it is sitting on.
 */
export interface Transport {
  readonly id: string;
  readonly isConnected: boolean;
  /** Device we are connected to, or `null` when idle. */
  readonly device: DiscoveredDevice | null;

  /** Whether this transport can run on the current platform at all. */
  isSupported(): boolean;
  /** Radio powered on, permissions granted. Throws with a readable reason. */
  ensureReady(): Promise<void>;
  scan(onDevice: (device: DiscoveredDevice) => void, timeoutMs?: number): Promise<void>;
  stopScan(): Promise<void>;
  /**
   * `serviceUuid` only means anything to transports that address a service by
   * UUID (the RFCOMM link); the others ignore it.
   */
  connect(deviceId: string, serviceUuid?: string): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Register a listener for inbound bytes. Returns an unsubscribe function. */
  onData(listener: (data: Uint8Array) => void): () => void;
  /** Fires when the link drops for any reason other than our own disconnect. */
  onDisconnect(listener: (reason?: string) => void): () => void;
}

/**
 * Transports that can enumerate what the remote device offers. Only Bluetooth
 * Classic can: a BLE peripheral's services are read after connecting, not
 * before.
 */
export interface ServiceInspectable {
  discoverServices(deviceId: string): Promise<string[]>;
}

export function canInspectServices(transport: Transport): transport is Transport & ServiceInspectable {
  return typeof (transport as Partial<ServiceInspectable>).discoverServices === 'function';
}

export class TransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportError';
  }
}
