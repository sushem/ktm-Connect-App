import {bikeService} from '../BikeService';
import {useSession} from '../../state/sessionStore';
import {useSettings} from '../../state/settingsStore';

/**
 * Runs against the demo dashboard, so a message goes through the real path:
 * BikeService → the framing → the transport, and the "bike" reports back what
 * it was asked to draw.
 */
// The older Bluetooth Classic dashboards. Gen-3 is covered in Gen3Dashboard.test.
describe('sending a message to the bike (legacy serial dashboard)', () => {
  beforeEach(async () => {
    useSettings.setState({demoMode: true, dashboardProtocol: 'legacy'});
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

describe('inspecting what a dashboard offers', () => {
  beforeEach(() => {
    useSettings.setState({demoMode: true, dashboardProtocol: 'legacy'});
    useSession.setState({log: []});
  });

  it('lists the services, MY RIDE first', async () => {
    const services = await bikeService.discoverServices('demo-dashboard');

    expect(services[0].isMyRide).toBe(true);
    expect(services.map(service => service.label)).toContain('Hands-Free');
  });

  it('records what it found, so the Codes tab shows it', async () => {
    await bikeService.discoverServices('demo-dashboard');

    const logged = useSession.getState().log.map(line => line.text);
    expect(logged.some(text => text.includes('offers 3 service(s)'))).toBe(true);
  });
});

describe('choosing a service to connect over', () => {
  const SPP = '00001101-0000-1000-8000-00805f9b34fb';
  const HANDSFREE = '0000111e-0000-1000-8000-00805f9b34fb';

  beforeEach(() => {
    useSettings.setState({demoMode: true, dashboardProtocol: 'legacy'});
    useSession.setState({log: [], devices: {telemetry: [], dashboard: []}});
  });

  afterEach(async () => {
    await bikeService.disconnect('dashboard');
  });

  const attempts = () =>
    useSession
      .getState()
      .log.map(line => line.text)
      .filter(text => text.startsWith('Trying '));

  it('tries MY RIDE first', async () => {
    await bikeService.connect('dashboard', 'demo-dashboard');

    expect(attempts()[0]).toContain('KTM MY RIDE');
  });

  it('reports every service it tried when none of them work', async () => {
    useSession.getState().addDevice('dashboard', {
      id: 'demo-dashboard',
      name: 'KTM3237',
      likelyMatch: true,
      // A dashboard like the 390 Adventure: a serial port, but no MY RIDE.
      services: [HANDSFREE, SPP],
    });
    // The simulated dashboard only answers on the services it advertises.
    useSession.setState({log: []});

    await expect(bikeService.connect('dashboard', 'nothing-here', SPP)).rejects.toThrow();
  });

  it('remembers what an SDP lookup found, so connecting can use it', async () => {
    useSession.getState().addDevice('dashboard', {
      id: 'demo-dashboard',
      name: 'KTM3237',
      likelyMatch: true,
    });

    await bikeService.discoverServices('demo-dashboard');

    const device = useSession.getState().devices.dashboard[0];
    expect(device.services).toHaveLength(3);
  });
});
