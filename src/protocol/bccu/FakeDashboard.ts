import type {GattLink} from './BccuClient';
import {
  buildMirrored,
  computeTempIvAndSecret,
  decryptControl,
  decryptData,
  deriveSessionKeys,
  encryptControl,
  randomBytes,
} from './crypto';
import {AUTH_REPLY, AUTH_REQUEST, CMD_GENERATE_KEYS, CMD_HELLO, CMD_KEY_ACK_BASE} from './uuids';

/**
 * The two directions do not agree on where the command byte lives, and the
 * asymmetry is real rather than a mistake: the bike puts its command in byte 2,
 * while the phone puts a 0xFF marker there and its command in byte 4.
 */
const BIKE_COMMAND_BYTE = 2;
const PHONE_COMMAND_BYTE = 4;

/** A control message in the bike's layout. */
function bikeControlMessage(command: number): Uint8Array {
  const msg = randomBytes(16);
  msg[BIKE_COMMAND_BYTE] = command & 0xff;
  return msg;
}

/**
 * A Gen-3 dashboard, simulated.
 *
 * It plays the bike's half of the handshake — nonce, hello, key generation,
 * key selection — and then decrypts what is written to it. That makes the real
 * client testable without a motorcycle, and gives demo mode something to talk
 * to that exercises the actual protocol rather than a stub.
 */
export interface DashboardWrite {
  characteristic: string;
  /** The decrypted payload, as the dashboard would see it. */
  payload: Uint8Array;
}

export interface FakeDashboardOptions {
  /** Which key from the pool to select. The real dashboard rotates. */
  keyIndex?: number;
  /**
   * Skip key generation and resume from a pool, the way a bike that already
   * knows this phone does.
   */
  resumeWithKeys?: Uint8Array[];
  /** Delay before the rider accepts the pairing prompt, in ms. */
  promptDelayMs?: number;
  onWrite?: (write: DashboardWrite) => void;
}

export class FakeDashboard implements GattLink {
  private listeners = new Map<string, (value: Uint8Array) => void>();
  private m1 = randomBytes(16);
  private iv: Uint8Array | null = null;
  private secret: Uint8Array | null = null;
  private challenge: Uint8Array | null = null;
  private keys: Uint8Array[] | null = null;
  private activeKey: Uint8Array | null = null;

  readonly writes: DashboardWrite[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private options: FakeDashboardOptions = {}) {}

  /** True once the dashboard considers the phone authenticated. */
  get authenticated(): boolean {
    return this.activeKey != null;
  }

  subscribe(
    _service: string,
    characteristic: string,
    listener: (value: Uint8Array) => void,
  ): () => void {
    this.listeners.set(characteristic, listener);
    if (characteristic === AUTH_REQUEST) {
      // The bike opens the conversation as soon as anyone is listening.
      this.emitLater(AUTH_REQUEST, this.m1);
    }
    return () => this.listeners.delete(characteristic);
  }

  async write(_service: string, characteristic: string, value: Uint8Array): Promise<void> {
    if (characteristic === AUTH_REPLY) {
      await this.handleAuthReply(value);
      return;
    }
    const key = this.activeKey;
    const iv = this.iv;
    if (!key || !iv) {
      throw new Error(`Write to ${characteristic} before authentication`);
    }
    const write = {characteristic, payload: decryptData(value, key, iv)};
    this.writes.push(write);
    this.options.onWrite?.(write);
  }

  private async handleAuthReply(value: Uint8Array): Promise<void> {
    if (!this.iv || !this.secret) {
      const temp = computeTempIvAndSecret(this.m1, value.slice(0, 16));
      this.iv = temp.iv;
      this.secret = temp.secret;
      this.sendControl(CMD_HELLO);
      return;
    }

    const command = decryptControl(value, this.secret, this.iv)[PHONE_COMMAND_BYTE];

    if (command === CMD_HELLO) {
      const resuming = this.options.resumeWithKeys;
      if (resuming) {
        // A bike that remembers this phone goes straight to picking a key.
        this.keys = resuming;
        this.sendControl(CMD_KEY_ACK_BASE | this.keyIndex());
      } else {
        // The challenge is whatever plaintext we send: the client derives the
        // session keys straight from it, so both sides must keep this exact copy.
        this.challenge = bikeControlMessage(CMD_GENERATE_KEYS);
        this.emitLater(
          AUTH_REQUEST,
          encryptControl(this.challenge, this.secret, this.iv),
          this.options.promptDelayMs,
        );
      }
      return;
    }

    // The client's acknowledgement of key generation.
    if (command === 2 && this.challenge) {
      this.keys = deriveSessionKeys(
        this.challenge,
        buildMirrored(this.challenge),
        this.iv,
        this.secret,
      );
      this.sendControl(CMD_KEY_ACK_BASE | this.keyIndex());
      return;
    }

    if (command === (CMD_KEY_ACK_BASE | this.keyIndex()) && this.keys) {
      this.activeKey = this.keys[this.keyIndex()];
    }
  }

  private keyIndex(): number {
    return this.options.keyIndex ?? 0;
  }

  private sendControl(command: number): void {
    if (!this.iv || !this.secret) {
      return;
    }
    this.emitLater(
      AUTH_REQUEST,
      encryptControl(bikeControlMessage(command), this.secret, this.iv),
    );
  }

  /** Drop anything still pending, so a test does not leave timers running. */
  close(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.listeners.clear();
  }

  /** Bluetooth is never synchronous; neither is this. */
  private emitLater(characteristic: string, value: Uint8Array, delayMs = 0): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.listeners.get(characteristic)?.(value);
    }, delayMs);
    this.timers.add(timer);
  }
}
