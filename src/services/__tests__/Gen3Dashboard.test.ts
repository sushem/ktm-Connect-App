import {NOTIFICATION, NAVIGATION_STATE, TURN_ICON, TURN_ROAD} from '../../protocol/bccu/uuids';
import {NotificationIcon, TurnIcon, Visibility} from '../../protocol/bccu/payloads';
import {utf8Decode} from '../../protocol/ktm/framing';
import {guidanceView, notificationView} from '../../protocol/ktm/messages';
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
