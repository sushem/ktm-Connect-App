import {BccuClient, type GattLink} from '../protocol/bccu/BccuClient';
import {FakeDashboard} from '../protocol/bccu/FakeDashboard';
import {NotificationIcon, Visibility} from '../protocol/bccu/payloads';
import {toGen3Icon} from '../protocol/bccu/turnIcons';
import type {DashboardView} from '../protocol/ktm/messages';
import {BleGattLink} from '../transport/BleGattLink';
import {listBondedDevices} from '../transport/KtmLinkTransport';
import type {DiscoveredDevice} from '../core/types';
import {persistentKeyStore} from '../state/keyStore';

/** A connection to a dashboard: the radio, or a simulation of one. */
export interface Gen3Link extends GattLink {
  connect(deviceId: string, onDisconnect?: (reason?: string) => void): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Timings taken from the reference implementation's field experience.
 *
 * A first pairing waits on the rider accepting a prompt on the dashboard, so
 * it gets a much longer budget than a bike that already knows this phone. The
 * cooldowns are deliberately unhurried: hammering a dashboard that is still
 * waking was suspected of re-triggering its "add device" prompt.
 */
const HANDSHAKE_BUDGET_FIRST_PAIR_MS = 75_000;
const HANDSHAKE_BUDGET_KNOWN_MS = 25_000;
const COOLDOWN_FIRST_MS = 15_000;
const COOLDOWN_LATER_MS = 45_000;
const MAX_ATTEMPTS = 3;

export interface Gen3Options {
  onLog?: (line: string) => void;
  /** Progress worth putting in front of the rider while connecting. */
  onProgress?: (message: string) => void;
  onDisconnect?: (reason?: string) => void;
  /** Talk to a simulated dashboard instead of a radio. */
  demo?: boolean;
  /** Injectable for tests; defaults to a real BLE link, or a fake in demo mode. */
  createLink?: () => Gen3Link;
  cooldownMs?: (attempt: number) => number;
}

/**
 * The Gen-3 dashboard link.
 *
 * Connecting is a retry loop rather than a single attempt, because that is
 * what the hardware requires: the dashboard routinely drops the link partway
 * through the first handshake — around the point it puts its "add this device"
 * prompt on screen — and only completes on a later attempt, once the rider has
 * accepted. Treating that first drop as a failure, which is the obvious way to
 * write this, never gets past pairing.
 */
export class Gen3Dashboard {
  private link: Gen3Link | null = null;
  private client: BccuClient | null = null;
  private connectedDevice: DiscoveredDevice | null = null;
  private view: DashboardView = {uiContext: 'default'};

  constructor(private options: Gen3Options = {}) {}

  get isConnected(): boolean {
    return this.client?.isAuthenticated === true;
  }

  get device(): DiscoveredDevice | null {
    return this.connectedDevice;
  }

  get currentView(): DashboardView {
    return this.view;
  }

  /** In demo mode, the simulated dashboard on the other end. */
  get simulated(): FakeDashboard | null {
    return this.link instanceof FakeDashboard ? this.link : null;
  }

  async scan(onDevice: (device: DiscoveredDevice) => void): Promise<void> {
    if (this.options.demo) {
      onDevice({id: 'demo-gen3', name: 'Demo KTM dashboard', likelyMatch: true});
      return;
    }

    // Bonded devices first. A dashboard that is already connected over
    // Bluetooth Classic for music and calls frequently stops advertising, so
    // a scan on its own will not find it — but its address is in the bond
    // list, and that is all a BLE connection needs.
    const bonded = await listBondedDevices();
    bonded.forEach(onDevice);
    if (bonded.length > 0) {
      this.log(`${bonded.length} paired device(s) listed; scanning for more`);
    }

    const link = this.createLink();
    if (link instanceof BleGattLink) {
      await link.scan(onDevice);
    }
  }

  async stopScan(): Promise<void> {
    if (this.link instanceof BleGattLink) {
      await this.link.stopScan();
    }
  }

  /** Connect and authenticate, retrying through the drops that pairing causes. */
  async connect(deviceId: string): Promise<void> {
    await this.disconnect();

    const known = (await persistentKeyStore.load(deviceId)) != null;
    const budget = known ? HANDSHAKE_BUDGET_KNOWN_MS : HANDSHAKE_BUDGET_FIRST_PAIR_MS;
    this.log(
      known
        ? 'This bike has paired with the app before; resuming'
        : 'First time with this bike — the dashboard will ask you to confirm this phone',
    );

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.progress(`Connecting to the bike (attempt ${attempt} of ${MAX_ATTEMPTS})`);
      try {
        await this.attempt(deviceId, budget);
        this.progress('');
        return;
      } catch (error) {
        lastError = error;
        this.log(`Attempt ${attempt} did not complete: ${describe(error)}`);
        await this.teardown();

        if (attempt < MAX_ATTEMPTS) {
          const cooldown = this.cooldown(attempt);
          this.progress(
            `The bike dropped the link. Trying again in ${Math.round(cooldown / 1000)}s — if the dashboard is asking you to confirm this phone, accept it now.`,
          );
          await delay(cooldown);
        }
      }
    }

    this.progress('');
    throw new Error(
      `Could not finish the handshake after ${MAX_ATTEMPTS} attempts. ${describe(lastError)}`,
    );
  }

  private async attempt(deviceId: string, budgetMs: number): Promise<void> {
    const link = this.createLink();
    this.link = link;

    let client: BccuClient | null = null;
    await link.connect(deviceId, reason => {
      // A drop after authentication is the ride ending; before it, it is the
      // dashboard doing what it does during pairing, and the loop retries.
      if (client?.isAuthenticated) {
        this.client = null;
        this.options.onDisconnect?.(reason);
      } else {
        client?.abort(reason ?? 'The bike dropped the link during the handshake');
      }
    });

    client = new BccuClient(link, deviceId, persistentKeyStore, {
      onLog: line => this.log(line),
      timeoutMs: budgetMs,
    });

    await client.authenticate();
    this.client = client;

    await client.setGuidance(true);
    this.connectedDevice =
      (link instanceof BleGattLink ? link.connectedDevice : null) ??
      {id: deviceId, name: this.options.demo ? 'Demo KTM dashboard' : deviceId, likelyMatch: true};
  }

  async disconnect(): Promise<void> {
    await this.teardown();
    this.connectedDevice = null;
  }

  /** A line of text in the dashboard's notification banner. */
  async showMessage(text: string): Promise<void> {
    await this.require().sendNotification(text, NotificationIcon.Information);
    this.view = {...this.view, uiContext: 'default', notificationText: text};
  }

  /** Push a whole view: the turn fields, or a plain message. */
  async show(view: DashboardView): Promise<void> {
    const client = this.require();

    if (view.uiContext === 'guidance') {
      await client.setGuidance(true);
      await client.sendTurnIcon(toGen3Icon(view.turnIcon));
      await client.sendTurnDistance([view.turnDist, view.turnDistUnit].filter(Boolean).join(' '));
      await client.sendTurnRoad(view.turnRoad ?? '');
      await client.sendEta(view.eta ?? '');
      await client.sendRemainingDistance(view.dist2Target ?? '');
      if (view.turnInfo) {
        await client.sendTurnInfo(view.turnInfo);
      }
    } else if (view.notificationText) {
      await client.sendNotification(view.notificationText, NotificationIcon.Information);
    } else {
      await this.clear(client);
    }

    this.view = view;
  }

  /** Hand the screen back to the bike. */
  async restore(): Promise<void> {
    await this.clear(this.require());
    this.view = {uiContext: 'default'};
  }

  private async clear(client: BccuClient): Promise<void> {
    await client.clearNotification();
    await client.sendTurnIcon(toGen3Icon(undefined), Visibility.Off);
    await client.setGuidance(false, false);
  }

  /**
   * Drop everything. A fresh link per attempt is deliberate: reusing one that
   * has already disconnected is a well-known source of connections that then
   * fail silently.
   */
  private async teardown(): Promise<void> {
    this.client?.close();
    this.client = null;
    const link = this.link;
    this.link = null;
    await link?.disconnect().catch(() => {});
  }

  private createLink(): Gen3Link {
    if (this.options.createLink) {
      return this.options.createLink();
    }
    return this.options.demo ? new FakeDashboard() : new BleGattLink();
  }

  private cooldown(attempt: number): number {
    return this.options.cooldownMs
      ? this.options.cooldownMs(attempt)
      : attempt <= 1
        ? COOLDOWN_FIRST_MS
        : COOLDOWN_LATER_MS;
  }

  private require(): BccuClient {
    const client = this.client;
    if (!client?.isAuthenticated) {
      throw new Error('The dashboard link is not connected');
    }
    return client;
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private progress(message: string): void {
    this.options.onProgress?.(message);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
