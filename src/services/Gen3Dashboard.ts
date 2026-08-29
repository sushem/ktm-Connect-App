import {BccuClient} from '../protocol/bccu/BccuClient';
import {FakeDashboard} from '../protocol/bccu/FakeDashboard';
import {NotificationIcon, Visibility} from '../protocol/bccu/payloads';
import {toGen3Icon} from '../protocol/bccu/turnIcons';
import type {DashboardView} from '../protocol/ktm/messages';
import {BleGattLink} from '../transport/BleGattLink';
import type {DiscoveredDevice} from '../core/types';
import {persistentKeyStore} from '../state/keyStore';

export interface Gen3Options {
  onLog?: (line: string) => void;
  onDisconnect?: (reason?: string) => void;
  /** Talk to a simulated dashboard instead of a radio. */
  demo?: boolean;
}

/**
 * The Gen-3 dashboard link.
 *
 * Wraps the BLE connection, the authenticated session and the mapping from the
 * app's view model onto the dashboard's individual characteristics, so the
 * rest of the app can treat it the same way as the older serial link.
 */
export class Gen3Dashboard {
  private link: BleGattLink | null = null;
  private fake: FakeDashboard | null = null;
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
    return this.fake;
  }

  async scan(onDevice: (device: DiscoveredDevice) => void): Promise<void> {
    if (this.options.demo) {
      onDevice({id: 'demo-gen3', name: 'Demo KTM dashboard', likelyMatch: true});
      return;
    }
    await this.gatt().scan(onDevice);
  }

  async stopScan(): Promise<void> {
    await this.link?.stopScan();
  }

  /**
   * Connect, authenticate, and switch guidance on — the dashboard renders
   * nothing until that flag is set.
   */
  async connect(deviceId: string): Promise<void> {
    await this.disconnect();

    const gatt = this.options.demo ? new FakeDashboard() : this.gatt();
    if (this.options.demo) {
      this.fake = gatt as FakeDashboard;
    } else {
      await (gatt as BleGattLink).connect(deviceId, reason => {
        this.client = null;
        this.options.onDisconnect?.(reason);
      });
    }

    const client = new BccuClient(gatt, deviceId, persistentKeyStore, {
      onLog: line => this.options.onLog?.(line),
    });
    this.log('Authenticating — if the bike asks you to confirm a new device, accept it');
    await client.authenticate();
    this.client = client;

    await client.setGuidance(true);
    this.connectedDevice =
      this.options.demo
        ? {id: deviceId, name: 'Demo KTM dashboard', likelyMatch: true}
        : ((gatt as BleGattLink).connectedDevice ?? {id: deviceId, name: deviceId, likelyMatch: true});
  }

  async disconnect(): Promise<void> {
    this.client?.close();
    this.client = null;
    this.fake?.close();
    this.fake = null;
    await this.link?.disconnect();
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
      await client.sendTurnDistance(
        [view.turnDist, view.turnDistUnit].filter(Boolean).join(' '),
      );
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

  private require(): BccuClient {
    const client = this.client;
    if (!client?.isAuthenticated) {
      throw new Error('The dashboard link is not connected');
    }
    return client;
  }

  private gatt(): BleGattLink {
    if (!this.link) {
      this.link = new BleGattLink();
    }
    return this.link;
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }
}
