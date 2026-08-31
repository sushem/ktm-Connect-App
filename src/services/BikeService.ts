import type {LinkId, Telemetry} from '../core/types';
import type {BluetoothService} from '../protocol/ktm/services';
import {connectionCandidates, describeService, describeServices} from '../protocol/ktm/services';
import {KtmDashboardClient} from '../protocol/ktm/KtmDashboardClient';
import {Gen3Dashboard} from './Gen3Dashboard';
import type {DashboardView} from '../protocol/ktm/messages';
import {notificationView, restoreView} from '../protocol/ktm/messages';
import {ObdClient} from '../protocol/obd/ObdClient';
import {BleTransport} from '../transport/BleTransport';
import {DemoDashboardTransport, DemoObdTransport} from '../transport/demo';
import {KtmLinkTransport} from '../transport/KtmLinkTransport';
import {canInspectServices, type Transport} from '../transport/types';
import {useSession} from '../state/sessionStore';
import {useSettings} from '../state/settingsStore';
import {estimateGear} from '../utils/gear';
import {forgetDashboardKeys} from '../state/keyStore';

/**
 * Owns the radios and the two protocol clients, and keeps the stores in step
 * with them. The screens call into this and read from the stores; nothing in
 * the UI touches a transport directly.
 */
class BikeService {
  private transports: Partial<Record<LinkId, Transport>> = {};
  private obd: ObdClient | null = null;
  private dashboard: KtmDashboardClient | null = null;
  private gen3: Gen3Dashboard | null = null;
  private demoBacking: 'demo' | 'real' | null = null;
  private gen3Demo: boolean | null = null;
  private mirrorTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether the dashboard link can work here. The Gen-3 protocol is BLE, so it
   * runs on both platforms; the older serial one is Android-only.
   */
  dashboardSupported(): boolean {
    if (useSettings.getState().dashboardProtocol === 'gen3') {
      return true;
    }
    return this.transportFor('dashboard').isSupported();
  }

  private get useGen3(): boolean {
    return useSettings.getState().dashboardProtocol === 'gen3';
  }

  /** The Gen-3 link, created on demand and rebuilt when demo mode changes. */
  private gen3Dashboard(): Gen3Dashboard {
    const demo = useSettings.getState().demoMode;
    if (this.gen3 && this.gen3Demo === demo) {
      return this.gen3;
    }
    void this.gen3?.disconnect();
    this.gen3Demo = demo;
    this.gen3 = new Gen3Dashboard({
      demo,
      onLog: line => useSession.getState().appendLog('dashboard', line),
      // Pairing takes a while and involves the rider walking to the bike, so
      // progress goes on the card rather than only into the log.
      onProgress: message =>
        useSession.getState().setLink('dashboard', {message: message || undefined}),
      onDisconnect: reason => this.handleDrop('dashboard', reason),
    });
    return this.gen3;
  }

  async scan(link: LinkId): Promise<void> {
    const session = useSession.getState();
    const transport = this.transportFor(link);

    session.setDevices(link, []);
    session.setLink(link, {status: 'scanning', message: undefined});
    try {
      if (link === 'dashboard' && this.useGen3) {
        await this.gen3Dashboard().scan(device => session.addDevice(link, device));
      } else {
        await transport.scan(device => session.addDevice(link, device));
      }
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

  /**
   * List the Bluetooth services a paired device offers. Only the RFCOMM
   * transport can answer this; anything else reports nothing.
   */
  async discoverServices(deviceId: string): Promise<BluetoothService[]> {
    const transport = this.transportFor('dashboard');
    const session = useSession.getState();
    if (!canInspectServices(transport)) {
      return [];
    }
    const uuids = await transport.discoverServices(deviceId);
    // Remember them, so connecting can try each serial service in turn.
    session.setDeviceServices('dashboard', deviceId, uuids);
    session.appendLog(
      'dashboard',
      uuids.length > 0
        ? `${deviceId} offers ${uuids.length} service(s): ${uuids.join(', ')}`
        : `${deviceId} advertised no services`,
    );
    return describeServices(uuids);
  }

  async connect(link: LinkId, deviceId: string, serviceUuid?: string): Promise<void> {
    const session = useSession.getState();
    const settings = useSettings.getState();
    const transport = this.transportFor(link);
    const device = session.devices[link].find(d => d.id === deviceId);

    session.setLink(link, {status: 'connecting', deviceId, deviceName: device?.name, message: undefined});

    try {
      let over: string | undefined;
      if (link === 'dashboard' && this.useGen3) {
        await this.gen3Dashboard().connect(deviceId);
        over = 'Gen-3 (BLE)';
        session.setDashboardView(this.gen3Dashboard().currentView);
        this.syncMirroring();
        settings.update({lastDashboardDeviceId: deviceId});
      } else if (link === 'dashboard') {
        over = await this.openDashboard(transport, deviceId, serviceUuid);
        transport.onDisconnect(reason => this.handleDrop(link, reason));
        await this.startDashboard();
        settings.update({lastDashboardDeviceId: deviceId});
      } else {
        await transport.connect(deviceId);
        transport.onDisconnect(reason => this.handleDrop(link, reason));
        await this.startTelemetry();
        settings.update({lastObdDeviceId: deviceId});
      }

      session.setLink(link, {
        status: 'connected',
        deviceId,
        deviceName: transport.device?.name ?? device?.name,
        service: over,
        message: undefined,
      });
    } catch (error) {
      session.setLink(link, {status: 'error', deviceId, message: describe(error)});
      if (link === 'dashboard' && this.useGen3) {
        await this.gen3?.disconnect().catch(() => {});
      } else {
        await transport.disconnect().catch(() => {});
      }
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
      await this.gen3?.disconnect().catch(() => {});
    }
    if (link === 'telemetry' || !this.useGen3) {
      await this.transportFor(link).disconnect().catch(() => {});
    }
    session.setLink(link, {status: 'idle', deviceId: undefined, deviceName: undefined, message: undefined});
  }

  /** Push a view to the bike's display and remember it in the store. */
  async showOnDashboard(view: DashboardView): Promise<void> {
    if (this.useGen3) {
      await this.gen3Dashboard().show(view);
    } else if (this.dashboard) {
      await this.dashboard.show(view);
    } else {
      throw new Error('The dashboard link is not connected');
    }
    useSession.getState().setDashboardView(view);
  }

  /**
   * Put a line of text on the bike's screen and keep it in the recent list.
   * The display holds it until something replaces it or the screen is restored.
   */
  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('There is nothing to send');
    }
    if (this.useGen3) {
      await this.gen3Dashboard().showMessage(trimmed);
      useSession.getState().setDashboardView(notificationView(trimmed));
    } else {
      await this.showOnDashboard(notificationView(trimmed));
    }
    useSession.getState().rememberMessage(trimmed);
  }

  /**
   * Drop the stored pairing for a bike.
   *
   * If the dashboard has forgotten this phone but the app has not, the app
   * expects a quick resume while the bike wants a full pairing, and the two
   * never meet. Clearing our side starts again from scratch.
   */
  async forgetDashboard(): Promise<void> {
    const settings = useSettings.getState();
    const deviceId =
      useSession.getState().links.dashboard.deviceId ?? settings.lastDashboardDeviceId;
    if (!deviceId) {
      throw new Error('No dashboard has been paired yet');
    }
    await this.disconnect('dashboard');
    await forgetDashboardKeys(deviceId);
    useSession.getState().appendLog('dashboard', `Forgot the pairing for ${deviceId}`);
  }

  async restoreDashboard(): Promise<void> {
    if (this.useGen3) {
      await this.gen3Dashboard().restore();
      useSession.getState().setDashboardView(restoreView());
      return;
    }
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

  /**
   * Try each serial service the dashboard offers, MY RIDE first.
   *
   * Not every dashboard carries the vendor service the 790 uses — a 390
   * Adventure advertises a plain Serial Port Profile instead — and there is no
   * way to tell which one speaks the protocol without opening a socket.
   */
  private async openDashboard(
    transport: Transport,
    deviceId: string,
    serviceUuid?: string,
  ): Promise<string> {
    const session = useSession.getState();
    const advertised = session.devices.dashboard.find(device => device.id === deviceId)?.services;

    // An explicitly chosen service is the only candidate; otherwise work
    // through everything the device advertises.
    const candidates = serviceUuid
      ? [describeService(serviceUuid)]
      : connectionCandidates(advertised ?? []);

    let lastError: unknown;
    for (const candidate of candidates) {
      session.appendLog('dashboard', `Trying ${candidate.label} (${candidate.uuid})`);
      try {
        await transport.connect(deviceId, candidate.uuid);
        session.appendLog('dashboard', `Connected over ${candidate.label}`);
        return candidate.label;
      } catch (error) {
        lastError = error;
        session.appendLog('dashboard', `${candidate.label} refused: ${describe(error)}`);
      }
    }

    const tried = candidates.map(candidate => candidate.label).join(', ');
    throw new Error(
      `None of the services on this device accepted a connection (tried ${tried}). ` +
        `Last error: ${describe(lastError)}`,
    );
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

    if (useSettings.getState().sendHandshake) {
      await client.handshake();
    } else {
      client.listen();
      session.appendLog('dashboard', 'Listening only — nothing sent');
    }
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
      if (telemetry.updatedAt == null) {
        return;
      }
      const units = useSettings.getState().units;
      const speed = telemetry.speedKph ?? 0;
      const shown = units === 'metric' ? `${Math.round(speed)} km/h` : `${Math.round(speed * 0.621371)} mph`;
      const gear = telemetry.gear ? `  |  gear ${telemetry.gear}` : '';
      void this.showOnDashboard(notificationView(`${shown}${gear}`)).catch(() => {});
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
      this.gen3 = null;
      this.gen3Demo = null;
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
