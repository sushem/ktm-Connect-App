import {BccuClient, type KeyStore} from '../BccuClient';
import {FakeDashboard} from '../FakeDashboard';
import {toHex} from '../crypto';
import {utf8Decode, utf8Encode} from '../../ktm/framing';
import {NotificationIcon, TurnIcon, Visibility} from '../payloads';
import {NAVIGATION_STATE, NOTIFICATION, TURN_ICON, TURN_ROAD} from '../uuids';

/** An in-memory key pool, standing in for what the app persists per bike. */
function memoryStore(): KeyStore & {pools: Map<string, Uint8Array[]>} {
  const pools = new Map<string, Uint8Array[]>();
  return {
    pools,
    load: async id => pools.get(id) ?? null,
    save: async (id, keys) => {
      pools.set(id, keys);
    },
  };
}

describe('authenticating with a Gen-3 dashboard', () => {
  it('completes the handshake and agrees on a session key', async () => {
    const bike = new FakeDashboard({keyIndex: 5});
    const store = memoryStore();
    const client = new BccuClient(bike, 'AA:BB:CC', store);

    await client.authenticate();

    expect(client.isAuthenticated).toBe(true);
    expect(bike.authenticated).toBe(true);
  });

  it('persists the key pool, because the bike keeps it too', async () => {
    const store = memoryStore();
    const client = new BccuClient(new FakeDashboard(), 'AA:BB:CC', store);

    await client.authenticate();

    expect(store.pools.get('AA:BB:CC')).toHaveLength(16);
  });

  it('reconnects from the stored pool when the bike skips key generation', async () => {
    const store = memoryStore();
    // First ride: pair, and keep the keys.
    await new BccuClient(new FakeDashboard(), 'AA:BB:CC', store).authenticate();
    const stored = store.pools.get('AA:BB:CC')!;

    // Next ignition cycle: the bike remembers us and just names a key.
    const bike = new FakeDashboard({resumeWithKeys: stored, keyIndex: 9});
    const client = new BccuClient(bike, 'AA:BB:CC', store);
    await client.authenticate();

    expect(client.isAuthenticated).toBe(true);
    expect(bike.authenticated).toBe(true);
  });

  it('gives up with an explanation if the rider never confirms', async () => {
    // A dashboard that prompts and is never answered.
    const bike = new FakeDashboard({promptDelayMs: 10_000});
    const client = new BccuClient(bike, 'AA:BB:CC', memoryStore(), {timeoutMs: 50});

    await expect(client.authenticate()).rejects.toThrow(/confirm a new device/i);
    expect(client.isAuthenticated).toBe(false);
    bike.close();
  });

  it('refuses to send anything before the handshake finishes', async () => {
    const client = new BccuClient(new FakeDashboard(), 'AA:BB:CC', memoryStore());

    await expect(client.sendNotification('too early')).rejects.toThrow(/not authenticated/i);
  });
});

describe('what the dashboard receives', () => {
  const connect = async () => {
    const bike = new FakeDashboard({keyIndex: 3});
    const client = new BccuClient(bike, 'AA:BB:CC', memoryStore());
    await client.authenticate();
    return {bike, client};
  };

  it('decrypts a notification back to the text that was sent', async () => {
    const {bike, client} = await connect();

    await client.sendNotification('Fuel stop next', NotificationIcon.Information);

    const write = bike.writes.find(w => w.characteristic === NOTIFICATION)!;
    expect(write.payload[0]).toBe(Visibility.Full);
    expect(write.payload[1]).toBe(NotificationIcon.Information);
    expect(utf8Decode(write.payload.subarray(2))).toBe('Fuel stop next');
  });

  it('caps a notification at the width of the banner', async () => {
    const {bike, client} = await connect();

    await client.sendNotification('This message is far too long for the dash');

    const write = bike.writes[bike.writes.length - 1];
    expect(write.payload.length - 2).toBe(16);
  });

  it('turns guidance on, which the dashboard needs before it renders anything', async () => {
    const {bike, client} = await connect();

    await client.setGuidance(true);

    const write = bike.writes.find(w => w.characteristic === NAVIGATION_STATE)!;
    // bit 0 guidance, bit 1 the GPS icon.
    expect(write.payload[0]).toBe(0b11);
  });

  it('sends a turn icon as visibility and code', async () => {
    const {bike, client} = await connect();

    await client.sendTurnIcon(TurnIcon.QuiteRight);

    const write = bike.writes.find(w => w.characteristic === TURN_ICON)!;
    expect(Array.from(write.payload)).toEqual([Visibility.Full, TurnIcon.QuiteRight]);
  });

  it('truncates a long road name with an ellipsis', async () => {
    const {bike, client} = await connect();

    await client.sendTurnRoad('An extremely long road name that will not fit on the display');

    const write = bike.writes.find(w => w.characteristic === TURN_ROAD)!;
    const text = utf8Decode(write.payload.subarray(1));
    expect(text).toHaveLength(32);
    expect(text.endsWith('...')).toBe(true);
  });

  it('encrypts every write — nothing goes out in the clear', async () => {
    const bike = new FakeDashboard();
    const seen: Uint8Array[] = [];
    const client = new BccuClient(
      {
        subscribe: (s, c, l) => bike.subscribe(s, c, l),
        write: async (s, c, v) => {
          seen.push(v);
          await bike.write(s, c, v);
        },
      },
      'AA:BB:CC',
      memoryStore(),
    );
    await client.authenticate();
    seen.length = 0;

    await client.sendNotification('secret');

    expect(seen).toHaveLength(1);
    // Ciphertext is whole AES blocks and contains none of the plaintext.
    expect(seen[0].length % 16).toBe(0);
    expect(toHex(seen[0])).not.toContain(toHex(utf8Encode('secret')));
  });
});
