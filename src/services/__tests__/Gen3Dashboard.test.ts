import {NOTIFICATION, NAVIGATION_STATE, TURN_ICON, TURN_ROAD} from '../../protocol/bccu/uuids';
import {NotificationIcon, TurnIcon, Visibility} from '../../protocol/bccu/payloads';
import {utf8Decode} from '../../protocol/ktm/framing';
import {guidanceView, notificationView} from '../../protocol/ktm/messages';
import {FakeDashboard} from '../../protocol/bccu/FakeDashboard';
import {Gen3Dashboard} from '../Gen3Dashboard';

/**
 * Runs against the simulated Gen-3 dashboard, so a message travels the real
 * path: view model → characteristic payload → session encryption → and back
 * out decrypted on the bike's side.
 */
describe('the Gen-3 dashboard link', () => {
  const connect = async () => {
    const dash = new Gen3Dashboard({demo: true});
    await dash.connect('demo-gen3');
    return dash;
  };

  const writes = (dash: Gen3Dashboard) => dash.simulated!.writes;
  const textOf = (payload: Uint8Array, from: number) => utf8Decode(payload.subarray(from));

  it('authenticates before it reports itself connected', async () => {
    const dash = await connect();

    expect(dash.isConnected).toBe(true);
    expect(dash.simulated!.authenticated).toBe(true);
    await dash.disconnect();
  });

  it('turns guidance on, without which the dashboard renders nothing', async () => {
    const dash = await connect();

    const state = writes(dash).find(write => write.characteristic === NAVIGATION_STATE);
    expect(state?.payload[0]).toBe(0b11);
    await dash.disconnect();
  });

  it('delivers a message the bike can read back', async () => {
    const dash = await connect();

    await dash.showMessage('Fuel stop next');

    const write = writes(dash).filter(w => w.characteristic === NOTIFICATION).pop()!;
    expect(write.payload[0]).toBe(Visibility.Full);
    expect(write.payload[1]).toBe(NotificationIcon.Information);
    expect(textOf(write.payload, 2)).toBe('Fuel stop next');
    await dash.disconnect();
  });

  it('maps a turn view onto the separate characteristics', async () => {
    const dash = await connect();

    await dash.show(
      guidanceView({icon: 'QUITE_RIGHT', road: 'B320', distanceM: 350, remainingM: 42000}),
    );

    const icon = writes(dash).filter(w => w.characteristic === TURN_ICON).pop()!;
    expect(Array.from(icon.payload)).toEqual([Visibility.Full, TurnIcon.QuiteRight]);

    const road = writes(dash).filter(w => w.characteristic === TURN_ROAD).pop()!;
    expect(textOf(road.payload, 1)).toBe('B320');
    await dash.disconnect();
  });

  it('hands the screen back by hiding the fields and dropping guidance', async () => {
    const dash = await connect();
    await dash.showMessage('Hello');

    await dash.restore();

    const notification = writes(dash).filter(w => w.characteristic === NOTIFICATION).pop()!;
    expect(notification.payload[0]).toBe(Visibility.Off);
    const state = writes(dash).filter(w => w.characteristic === NAVIGATION_STATE).pop()!;
    expect(state.payload[0]).toBe(0);
    await dash.disconnect();
  });

  it('refuses to send once disconnected', async () => {
    const dash = await connect();
    await dash.disconnect();

    await expect(dash.showMessage('anyone there?')).rejects.toThrow(/not connected/i);
  });

  it('remembers what it last put on the screen', async () => {
    const dash = await connect();

    await dash.show(notificationView('Following you'));

    expect(dash.currentView.notificationText).toBe('Following you');
    await dash.disconnect();
  });
});

/**
 * A dashboard that drops the link partway through the first handshake, which
 * is what a real one does around the point it asks the rider to confirm a new
 * device. Giving up on that first drop is why pairing never completed.
 */
class FlakyDashboard extends FakeDashboard {
  private dropped = false;
  private onDisconnect?: (reason?: string) => void;

  constructor(private dropsBeforeSucceeding: number) {
    super();
  }

  static attempts = 0;

  async connect(deviceId: string, onDisconnect?: (reason?: string) => void): Promise<void> {
    this.onDisconnect = onDisconnect;
    await super.connect(deviceId, onDisconnect);
  }

  subscribe(service: string, characteristic: string, listener: (value: Uint8Array) => void) {
    const unsubscribe = super.subscribe(service, characteristic, listener);
    if (this.dropsBeforeSucceeding > 0 && !this.dropped) {
      this.dropped = true;
      // Drop shortly after the conversation starts, as the real one does.
      setTimeout(() => this.onDisconnect?.('The bike disconnected'), 5);
    }
    return unsubscribe;
  }
}

describe('pairing through the drops a real dashboard causes', () => {
  it('retries after a mid-handshake drop and completes', async () => {
    let attempt = 0;
    const dash = new Gen3Dashboard({
      cooldownMs: () => 1,
      createLink: () => {
        attempt += 1;
        // The first attempt is dropped; the second goes through, as it does
        // once the rider has accepted the prompt.
        return attempt === 1 ? new FlakyDashboard(1) : new FakeDashboard();
      },
    });

    await dash.connect('AA:BB:CC');

    expect(dash.isConnected).toBe(true);
    expect(attempt).toBe(2);
    await dash.disconnect();
  }, 20000);

  it('gives up with a readable reason when every attempt is dropped', async () => {
    const dash = new Gen3Dashboard({
      cooldownMs: () => 1,
      createLink: () => new FlakyDashboard(1),
    });

    await expect(dash.connect('AA:BB:CC')).rejects.toThrow(/after 3 attempts/i);
  }, 20000);

  it('tells the rider what is happening while it retries', async () => {
    const progress: string[] = [];
    let attempt = 0;
    const dash = new Gen3Dashboard({
      cooldownMs: () => 1,
      onProgress: message => progress.push(message),
      createLink: () => (++attempt === 1 ? new FlakyDashboard(1) : new FakeDashboard()),
    });

    await dash.connect('AA:BB:CC');

    expect(progress.some(line => /attempt 1 of 3/i.test(line))).toBe(true);
    expect(progress.some(line => /accept it now/i.test(line))).toBe(true);
    await dash.disconnect();
  }, 20000);
});

describe('making a message actually appear', () => {
  it('writes the guidance fields as well as the banner', async () => {
    const dash = new Gen3Dashboard({demo: true});
    await dash.connect('demo-gen3');

    await dash.showMessage('Fuel stop next');

    const written = dash.simulated!.writes.map(w => w.characteristic);
    // The reference's own connect greeting renders through these, so they are
    // the path known to work on a real dashboard.
    expect(written).toContain(TURN_ICON);
    expect(written).toContain(TURN_ROAD);
    expect(written).toContain(NOTIFICATION);

    const road = dash.simulated!.writes.filter(w => w.characteristic === TURN_ROAD).pop()!;
    expect(utf8Decode(road.payload.subarray(1))).toBe('Fuel stop next');
    await dash.disconnect();
  });

  it('switches guidance on before writing anything, or none of it renders', async () => {
    const dash = new Gen3Dashboard({demo: true});
    await dash.connect('demo-gen3');
    const beforeMessage = dash.simulated!.writes.length;

    await dash.showMessage('Hello');

    const order = dash.simulated!.writes.slice(beforeMessage).map(w => w.characteristic);
    expect(order[0]).toBe(NAVIGATION_STATE);
    await dash.disconnect();
  });
});
