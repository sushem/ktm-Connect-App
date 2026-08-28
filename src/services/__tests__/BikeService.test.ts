import {bikeService} from '../BikeService';
import {useSession} from '../../state/sessionStore';
import {useSettings} from '../../state/settingsStore';

/**
 * Runs against the demo dashboard, so a message goes through the real path:
 * BikeService → the framing → the transport, and the "bike" reports back what
 * it was asked to draw.
 */
describe('sending a message to the bike', () => {
  beforeEach(async () => {
    useSettings.setState({demoMode: true});
    useSession.setState({sentMessages: [], log: []});
    await bikeService.connect('dashboard', 'demo-dashboard');
  });

  afterEach(async () => {
    await bikeService.disconnect('dashboard');
  });

  /** What the simulated dashboard actually received, newest last. */
  const framesReachingTheBike = () =>
    useSession
      .getState()
      .log.filter(line => line.text.startsWith('dash ← '))
      .map(line => JSON.parse(line.text.replace('dash ← ', '')));

  it('puts the text on the display', async () => {
    await bikeService.sendMessage('Fuel stop next');

    const last = framesReachingTheBike().pop();
    expect(last.UpdateUI.NotificationText).toEqual({
      Text: 'Fuel stop next',
      Visibility: 'full',
    });
    expect(useSession.getState().dashboardView.notificationText).toBe('Fuel stop next');
  });

  it('trims the text before sending it', async () => {
    await bikeService.sendMessage('  Following you  ');

    expect(useSession.getState().dashboardView.notificationText).toBe('Following you');
    expect(useSession.getState().sentMessages).toEqual(['Following you']);
  });

  it('refuses to send nothing', async () => {
    await expect(bikeService.sendMessage('   ')).rejects.toThrow(/nothing to send/i);
    expect(framesReachingTheBike().filter(frame => frame.MsgId.startsWith('Restore#'))).toHaveLength(
      2,
    );
  });

  it('keeps a recent list with the newest first and no duplicates', async () => {
    await bikeService.sendMessage('one');
    await bikeService.sendMessage('two');
    await bikeService.sendMessage('one');

    expect(useSession.getState().sentMessages).toEqual(['one', 'two']);
  });

  it('hands the screen back when the message is cleared', async () => {
    await bikeService.sendMessage('Slowing down');
    await bikeService.restoreDashboard();

    const last = framesReachingTheBike().pop();
    expect(last.UiContext).toBe('default');
    expect(last.UpdateUI.NotificationText.Visibility).toBe('off');
    expect(useSession.getState().dashboardView.notificationText).toBeUndefined();
  });

  it('fails clearly when the dashboard is not connected', async () => {
    await bikeService.disconnect('dashboard');

    await expect(bikeService.sendMessage('Anyone there?')).rejects.toThrow(/not connected/i);
  });
});
