import type {LinkId, Telemetry} from '../core/types';
import {KtmDashboardClient} from '../protocol/ktm/KtmDashboardClient';
import type {DashboardView} from '../protocol/ktm/messages';
import {notificationView, restoreView} from '../protocol/ktm/messages';
import {ObdClient} from '../protocol/obd/ObdClient';
import {BleTransport} from '../transport/BleTransport';
import {DemoDashboardTransport, DemoObdTransport} from '../transport/demo';
import {KtmLinkTransport} from '../transport/KtmLinkTransport';
import type {Transport} from '../transport/types';
import {useSession} from '../state/sessionStore';
import {useSettings} from '../state/settingsStore';
import {estimateGear} from '../utils/gear';

/**
 * Owns the radios and the two protocol clients, and keeps the stores in step
 * with them. The screens call into this and read from the stores; nothing in
 * the UI touches a transport directly.
 */
class BikeService {
  private transports: Partial<Record<LinkId, Transport>> = {};
  private obd: ObdClient | null = null;
  private dashboard: KtmDashboardClient | null = null;
  private demoBacking: 'demo' | 'real' | null = null;
  private mirrorTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the dashboard link can work on this device at all. */
  dashboardSupported(): boolean {
    return this.transportFor('dashboard').isSupported();
  }

  async scan(link: LinkId): Promise<void> {
    const session = useSession.getState();
    const transport = this.transportFor(link);

    session.setDevices(link, []);
    session.setLink(link, {status: 'scanning', message: undefined});
    try {
      await transport.scan(device => session.addDevice(link, device));
      const found = useSession.getState().devices[link].length;
      session.setLink(link, {
        status: 'idle',
        message: found === 0 ? 'Nothing found. Is the adapter powered and in range?' : undefined,
      });
    } catch (error) {
      session.setLink(link, {status: 'error', message: describe(error)});
      throw error;
    }
  }

  async connect(link: LinkId, deviceId: string): Promise<void> {
    const session = useSession.getState();
    const settings = useSettings.getState();
    const transport = this.transportFor(link);
    const device = session.devices[link].find(d => d.id === deviceId);

    session.setLink(link, {status: 'connecting', deviceId, deviceName: device?.name, message: undefined});

    try {
      await transport.connect(deviceId);
      transport.onDisconnect(reason => this.handleDrop(link, reason));

      if (link === 'telemetry') {
        await this.startTelemetry();
        settings.update({lastObdDeviceId: deviceId});
      } else {
        await this.startDashboard();
        settings.update({lastDashboardDeviceId: deviceId});
      }

      session.setLink(link, {
        status: 'connected',
        deviceId,
        deviceName: transport.device?.name ?? device?.name,
        message: undefined,
      });
    } catch (error) {
      session.setLink(link, {status: 'error', deviceId, message: describe(error)});
      await transport.disconnect().catch(() => {});
      throw error;
    }
  }

  async disconnect(link: LinkId): Promise<void> {
    const session = useSession.getState();
    if (link === 'telemetry') {
      this.obd?.stop();
      await this.obd?.close();
      this.obd = null;
      session.resetTelemetry();
    } else {
      this.stopMirroring();
      this.dashboard?.close();
      this.dashboard = null;
    }
    await this.transportFor(link).disconnect().catch(() => {});
    session.setLink(link, {status: 'idle', deviceId: undefined, deviceName: undefined, message: undefined});
  }

  /** Push a view to the bike's display and remember it in the store. */
  async showOnDashboard(view: DashboardView): Promise<void> {
    if (!this.dashboard) {
      throw new Error('The dashboard link is not connected');
    }
    await this.dashboard.show(view);
    useSession.getState().setDashboardView(view);
  }

  async restoreDashboard(): Promise<void> {
    await this.showOnDashboard(restoreView());
  }

  async readDiagnosticCodes(): Promise<void> {
    if (!this.obd) {
      throw new Error('The telemetry link is not connected');
    }
    const codes = await this.obd.readDiagnosticCodes();
    useSession.getState().setCodes(codes);
    useSession.getState().appendLog('telemetry', `Read ${codes.length} stored code(s)`);
  }

  /**
   * Start or stop echoing speed and gear onto the bike's screen. Only worth
   * doing while both links are up.
   */
  syncMirroring(): void {
    const {mirrorTelemetryToDashboard} = useSettings.getState();
    const connected = useSession.getState().links.dashboard.status === 'connected';
    if (mirrorTelemetryToDashboard && connected) {
      this.startMirroring();
    } else {
      this.stopMirroring();
    }
  }

  private async startTelemetry(): Promise<void> {
    const session = useSession.getState();
    const transport = this.transportFor('telemetry');

    const client = new ObdClient(transport, {
      pollIntervalMs: useSettings.getState().pollIntervalMs,
      onLog: line => session.appendLog('telemetry', line),
    });
    this.obd = client;

    const supported = await client.initialize();
    session.appendLog('telemetry', `Polling ${supported.map(p => p.label).join(', ') || 'nothing'}`);
    session.startTrip();

    // Deliberately not awaited: the poll loop runs until the link goes away.
    void client.start(snapshot => this.publishTelemetry(snapshot));
  }

  private publishTelemetry(snapshot: Telemetry): void {
    const session = useSession.getState();
    const profile = useSettings.getState().profile();
    const merged = {...session.telemetry, ...snapshot};
    session.mergeTelemetry({
      ...snapshot,
      gear: estimateGear(merged.rpm, merged.speedKph, profile),
    });
  }

  private async startDashboard(): Promise<void> {
    const session = useSession.getState();
    const client = new KtmDashboardClient(this.transportFor('dashboard'), {
      onLog: line => session.appendLog('dashboard', line),
    });
    this.dashboard = client;
    await client.handshake();
    session.setDashboardView(client.currentView);
    this.syncMirroring();
  }

  private startMirroring(): void {
    if (this.mirrorTimer) {
      return;
    }
    // One update per second: enough to read at a glance, gentle on the link.
    this.mirrorTimer = setInterval(() => {
      const {telemetry} = useSession.getState();
      if (!this.dashboard || telemetry.updatedAt == null) {
        return;
      }
      const units = useSettings.getState().units;
      const speed = telemetry.speedKph ?? 0;
      const shown = units === 'metric' ? `${Math.round(speed)} km/h` : `${Math.round(speed * 0.621371)} mph`;
      const gear = telemetry.gear ? `  |  gear ${telemetry.gear}` : '';
      void this.dashboard.show(notificationView(`${shown}${gear}`)).catch(() => {});
    }, 1000);
  }

  private stopMirroring(): void {
    if (this.mirrorTimer) {
      clearInterval(this.mirrorTimer);
      this.mirrorTimer = null;
    }
  }

  private handleDrop(link: LinkId, reason?: string): void {
    const session = useSession.getState();
    if (link === 'telemetry') {
      this.obd?.stop();
      this.obd = null;
    } else {
      this.stopMirroring();
      this.dashboard = null;
    }
    session.setLink(link, {status: 'error', message: reason ?? 'Connection lost'});
    session.appendLog(link, reason ?? 'Connection lost');
  }

  /**
   * Transports are created on demand so that the BLE manager is only touched
   * once the user actually asks for a scan, and swapped wholesale when demo
   * mode is toggled.
   */
  private transportFor(link: LinkId): Transport {
    const wanted = useSettings.getState().demoMode ? 'demo' : 'real';
    if (this.demoBacking !== wanted) {
      this.transports = {};
      this.demoBacking = wanted;
    }
    const existing = this.transports[link];
    if (existing) {
      return existing;
    }

    const created: Transport =
      wanted === 'demo'
        ? link === 'telemetry'
          ? new DemoObdTransport()
          : new DemoDashboardTransport(payload => useSession.getState().appendLog('dashboard', `dash ← ${payload}`))
        : link === 'telemetry'
          ? new BleTransport()
          : new KtmLinkTransport();

    this.transports[link] = created;
    return created;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const bikeService = new BikeService();
