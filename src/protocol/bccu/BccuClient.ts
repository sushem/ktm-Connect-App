import {
  AUTH_REPLY,
  AUTH_REQUEST,
  CMD_GENERATE_KEYS,
  CMD_HELLO,
  CMD_KEY_ACK_BASE,
  MAIN_SERVICE,
  NAVIGATION_STATE,
  NOTIFICATION,
  TURN_DISTANCE,
  TURN_ICON,
  TURN_INFO,
  TURN_ROAD,
  ETA,
  REMAINING_DISTANCE,
  TBT_NAV_REQUEST,
} from './uuids';
import {
  buildControlMessage,
  buildMirrored,
  computeTempIvAndSecret,
  decryptControl,
  deriveSessionKeys,
  encryptControl,
  encryptData,
  randomBytes,
  toHex,
} from './crypto';
import {
  NotificationIcon,
  TurnIcon,
  Visibility,
  etaPayload,
  navigationStatePayload,
  notificationPayload,
  remainingDistancePayload,
  turnDistancePayload,
  turnIconPayload,
  turnInfoPayload,
  turnRoadPayload,
} from './payloads';

/** The GATT operations this client needs, so it can be tested without a radio. */
export interface GattLink {
  write(service: string, characteristic: string, value: Uint8Array): Promise<void>;
  subscribe(
    service: string,
    characteristic: string,
    listener: (value: Uint8Array) => void,
  ): () => void;
}

/** Somewhere to keep the key pool between rides. */
export interface KeyStore {
  load(deviceId: string): Promise<Uint8Array[] | null>;
  save(deviceId: string, keys: Uint8Array[]): Promise<void>;
}

export type BccuState = 'idle' | 'handshaking' | 'authenticated' | 'failed';

export interface BccuClientOptions {
  onLog?: (line: string) => void;
  onState?: (state: BccuState) => void;
  /** How long to wait for the bike before giving up. Pairing needs rider confirmation. */
  timeoutMs?: number;
}

/**
 * Talks to a Gen-3 dashboard.
 *
 * The handshake is the bike's to drive; we answer. It sends a nonce, we
 * interleave it with ours to make a temporary key, and from then on every
 * control message is encrypted under it. The bike then either derives a fresh
 * pool of session keys — the case that makes the dashboard ask the rider to
 * confirm a new device — or, if it remembers us, jumps straight to selecting
 * one from the pool it kept. That second path is why the pool has to be
 * persisted: without it a reconnect stalls with nothing to select from.
 */
export class BccuClient {
  private tempIv: Uint8Array | null = null;
  private tempSecret: Uint8Array | null = null;
  private sessionKeys: Uint8Array[] | null = null;
  private activeKey: Uint8Array | null = null;
  private unsubscribe: (() => void) | null = null;
  private state: BccuState = 'idle';
  private waiters: Array<{resolve: () => void; reject: (error: Error) => void}> = [];

  constructor(
    private link: GattLink,
    private deviceId: string,
    private keys: KeyStore,
    private options: BccuClientOptions = {},
  ) {}

  get isAuthenticated(): boolean {
    return this.state === 'authenticated' && this.activeKey != null;
  }

  /**
   * Subscribe and wait for the bike to take us through the handshake. On a
   * dashboard that has not seen this phone before, it will not finish until
   * the rider confirms the pairing prompt on the bike.
   */
  async authenticate(): Promise<void> {
    this.reset();
    this.setState('handshaking');
    this.unsubscribe = this.link.subscribe(MAIN_SERVICE, AUTH_REQUEST, value => {
      void this.handleAuthMessage(value);
    });

    const timeoutMs = this.options.timeoutMs ?? 60000;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(new Error('The bike did not finish the handshake. If it asked you to confirm a new device, accept it on the dashboard and try again.'));
      }, timeoutMs);

      this.waiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** Turn guidance on. The dashboard ignores the other fields until this is set. */
  async setGuidance(on: boolean, gpsIcon = true): Promise<void> {
    await this.sendData(NAVIGATION_STATE, navigationStatePayload(on, gpsIcon));
  }

  /**
   * Listen on the characteristic the dashboard uses to ask for navigation
   * data. The reference subscribes to it the moment it authenticates; whether
   * the dash requires a listener before it will render is not documented, so
   * we match its behaviour rather than guess.
   */
  listenForNavRequests(onRequest?: (data: Uint8Array) => void): void {
    try {
      this.link.subscribe(MAIN_SERVICE, TBT_NAV_REQUEST, value => {
        this.log(`The dashboard asked for navigation data (${value.length} bytes)`);
        onRequest?.(value);
      });
    } catch (error) {
      // Not every dashboard exposes it; that is not a reason to fail the link.
      this.log(`Could not listen for navigation requests: ${String(error)}`);
    }
  }

  async sendNotification(
    text: string,
    icon: NotificationIcon = NotificationIcon.Information,
    visibility = Visibility.Full,
  ): Promise<void> {
    await this.sendData(NOTIFICATION, notificationPayload(text, icon, visibility));
  }

  async clearNotification(): Promise<void> {
    await this.sendData(NOTIFICATION, notificationPayload('', NotificationIcon.Unknown, Visibility.Off));
  }

  async sendTurnIcon(icon: TurnIcon, visibility = Visibility.Full): Promise<void> {
    await this.sendData(TURN_ICON, turnIconPayload(icon, visibility));
  }

  async sendTurnDistance(text: string, visibility = Visibility.Full): Promise<void> {
    await this.sendData(TURN_DISTANCE, turnDistancePayload(text, visibility));
  }

  async sendTurnRoad(text: string): Promise<void> {
    await this.sendData(TURN_ROAD, turnRoadPayload(text));
  }

  async sendTurnInfo(text: string): Promise<void> {
    await this.sendData(TURN_INFO, turnInfoPayload(text));
  }

  async sendEta(text: string): Promise<void> {
    await this.sendData(ETA, etaPayload(text));
  }

  async sendRemainingDistance(text: string): Promise<void> {
    await this.sendData(REMAINING_DISTANCE, remainingDistancePayload(text));
  }

  /**
   * Give up on an in-flight handshake — the link went away underneath it.
   * The caller decides whether to try again.
   */
  abort(reason: string): void {
    this.settle(new Error(reason));
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.reset();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.settle(new Error('Closed'));
    this.reset();
    this.setState('idle');
  }

  /** Encrypt under the session key and write. */
  private async sendData(characteristic: string, payload: Uint8Array): Promise<void> {
    const key = this.activeKey;
    const iv = this.tempIv;
    if (!key || !iv) {
      throw new Error('Not authenticated with the dashboard yet');
    }
    await this.link.write(MAIN_SERVICE, characteristic, encryptData(payload, key, iv));
  }

  private async handleAuthMessage(value: Uint8Array): Promise<void> {
    const iv = this.tempIv;
    const secret = this.tempSecret;

    // First message of a session: the bike's nonce, in the clear.
    if (!iv || !secret) {
      if (value.length < 16) {
        return;
      }
      const m1 = value.slice(0, 16);
      const m2 = randomBytes(16);
      const temp = computeTempIvAndSecret(m1, m2);
      this.tempIv = temp.iv;
      this.tempSecret = temp.secret;
      this.log('Received the bike nonce, answering with ours');
      await this.link.write(MAIN_SERVICE, AUTH_REPLY, m2);
      return;
    }

    let decrypted: Uint8Array;
    try {
      decrypted = decryptControl(value, secret, iv);
    } catch (error) {
      this.log(`Could not decrypt a handshake message: ${String(error)}`);
      return;
    }
    if (decrypted.length < 3) {
      return;
    }

    // The bike puts its command in byte 2; our replies put a marker there and
    // the command in byte 4. The asymmetry is the protocol's, not a mistake.
    const command = decrypted[2];
    if (command === CMD_HELLO) {
      // Echo it back. Whether the dashboard prompts the rider is its own
      // decision, made from its bond memory — answering anything else stalls.
      this.log('Handshake: hello');
      await this.replyControl(CMD_HELLO);
      return;
    }

    if (command === CMD_GENERATE_KEYS) {
      const mirrored = buildMirrored(decrypted);
      const keys = deriveSessionKeys(decrypted, mirrored, iv, secret);
      this.sessionKeys = keys;
      // The bike keeps this pool across ignition cycles and later resumes by
      // selecting from it, so our copy has to outlive the process.
      await this.keys.save(this.deviceId, keys);
      this.log(`Handshake: derived ${keys.length} session keys`);
      await this.replyControl(2);
      return;
    }

    if (command >= CMD_KEY_ACK_BASE && command <= CMD_KEY_ACK_BASE + 15) {
      const index = command & 0x0f;
      let keys = this.sessionKeys;
      if (!keys) {
        // A reconnect: the bike skipped key generation and picked from the
        // pool it has kept since pairing.
        keys = await this.keys.load(this.deviceId);
        if (keys) {
          this.log(`Restored ${keys.length} stored session keys`);
          this.sessionKeys = keys;
        }
      }
      if (!keys || index >= keys.length) {
        this.log(`The bike selected key ${index}, but no key pool is available`);
        return;
      }
      this.activeKey = keys[index];
      await this.replyControl(CMD_KEY_ACK_BASE | index);
      this.log(`Authenticated on key ${index} (${toHex(this.activeKey).slice(0, 8)}…)`);
      this.setState('authenticated');
      this.settle();
    }
  }

  private async replyControl(command: number): Promise<void> {
    const iv = this.tempIv;
    const secret = this.tempSecret;
    if (!iv || !secret) {
      return;
    }
    const message = buildControlMessage(command);
    await this.link.write(MAIN_SERVICE, AUTH_REPLY, encryptControl(message, secret, iv));
  }

  private settle(error?: Error): void {
    const waiters = this.waiters;
    this.waiters = [];
    if (error) {
      if (this.state === 'handshaking') {
        this.setState('failed');
      }
      waiters.forEach(waiter => waiter.reject(error));
    } else {
      waiters.forEach(waiter => waiter.resolve());
    }
  }

  private reset(): void {
    this.tempIv = null;
    this.tempSecret = null;
    this.sessionKeys = null;
    this.activeKey = null;
  }

  private setState(state: BccuState): void {
    this.state = state;
    this.options.onState?.(state);
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }
}
