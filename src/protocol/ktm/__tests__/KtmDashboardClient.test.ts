import {DemoDashboardTransport} from '../../../transport/demo';
import {KtmDashboardClient} from '../KtmDashboardClient';
import {guidanceView, notificationView} from '../messages';

describe('KtmDashboardClient', () => {
  const setup = async () => {
    const received: string[] = [];
    const transport = new DemoDashboardTransport(payload => received.push(payload));
    await transport.connect('demo');
    return {transport, received, client: new KtmDashboardClient(transport)};
  };

  it('opens with two restore frames, as the display expects', async () => {
    const {client, received} = await setup();
    await client.handshake();

    expect(received).toHaveLength(2);
    expect(JSON.parse(received[0]).MsgId).toBe('Restore#0');
    expect(JSON.parse(received[1]).MsgId).toBe('Restore#1');
  });

  it('increments the message id so the display accepts each update', async () => {
    const {client, received} = await setup();
    await client.handshake();
    await client.show(notificationView('Fuel low'));
    await client.show(guidanceView({icon: 'KEEP_LEFT', road: 'B320'}));

    expect(JSON.parse(received[2]).MsgId).toBe('Restore#2');
    expect(JSON.parse(received[3]).MsgId).toBe('gon#3');
  });

  it('remembers the current view so a reconnect can repaint it', async () => {
    const {client, received} = await setup();
    await client.handshake();
    await client.show(notificationView('Hold on'));
    await client.repaint();

    expect(client.currentView.notificationText).toBe('Hold on');
    expect(JSON.parse(received[3]).UpdateUI.NotificationText.Text).toBe('Hold on');
  });

  it('hands the screen back with a restore frame', async () => {
    const {client, received} = await setup();
    await client.handshake();
    await client.show(guidanceView({icon: 'END'}));
    await client.restore();

    const last = JSON.parse(received[received.length - 1]);
    expect(last.UiContext).toBe('default');
    expect(last.UpdateUI.TurnIcon.Visibility).toBe('off');
  });
});

describe('listening without writing', () => {
  it('attaches to the stream but sends nothing', async () => {
    const received: string[] = [];
    const transport = new DemoDashboardTransport(payload => received.push(payload));
    await transport.connect('demo');
    const client = new KtmDashboardClient(transport);

    client.listen();

    expect(received).toEqual([]);
  });

  it('still numbers from zero once it does start talking', async () => {
    const received: string[] = [];
    const transport = new DemoDashboardTransport(payload => received.push(payload));
    await transport.connect('demo');
    const client = new KtmDashboardClient(transport);

    client.listen();
    await client.show(notificationView('Hello'));

    expect(JSON.parse(received[0]).MsgId).toBe('Restore#0');
  });
});
