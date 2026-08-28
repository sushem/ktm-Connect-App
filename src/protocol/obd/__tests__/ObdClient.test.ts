import type {Telemetry} from '../../../core/types';
import {DemoObdTransport} from '../../../transport/demo';
import {ObdClient} from '../ObdClient';

/**
 * The demo transport is a stand-in ELM327, so these exercise the real command
 * queue, the response parser and the poll loop end to end.
 */
describe('ObdClient against a simulated adapter', () => {
  it('probes the ECU and keeps only the PIDs it answers', async () => {
    const transport = new DemoObdTransport();
    await transport.connect('demo');
    const client = new ObdClient(transport);

    const supported = await client.initialize();

    expect(supported.map(pid => pid.pid)).toEqual(
      expect.arrayContaining(['0C', '0D', '05', '42']),
    );
    await client.close();
  });

  it('reads plausible values for the gauges', async () => {
    const transport = new DemoObdTransport();
    await transport.connect('demo');
    const client = new ObdClient(transport);
    await client.initialize();

    const rpm = await client.readPid(client.activePids.find(p => p.pid === '0C')!);
    const speed = await client.readPid(client.activePids.find(p => p.pid === '0D')!);

    expect(rpm).toBeGreaterThan(1000);
    expect(rpm).toBeLessThanOrEqual(11000);
    expect(speed).toBeGreaterThanOrEqual(0);
    expect(speed).toBeLessThan(255);
    await client.close();
  });

  it('publishes snapshots until it is stopped', async () => {
    const transport = new DemoObdTransport();
    await transport.connect('demo');
    const client = new ObdClient(transport, {pollIntervalMs: 1});
    await client.initialize();

    const snapshots: Telemetry[] = [];
    const loop = client.start(snapshot => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        client.stop();
      }
    });
    await loop;

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]).toHaveProperty('rpm');
    expect(snapshots[0]).toHaveProperty('updatedAt');
    await client.close();
  }, 20000);

  it('reads stored trouble codes', async () => {
    const transport = new DemoObdTransport();
    await transport.connect('demo');
    const client = new ObdClient(transport);
    await client.initialize();

    const codes = await client.readDiagnosticCodes();

    expect(codes.map(code => code.code)).toEqual(['P0143']);
    await client.close();
  });

  it('gives up on a command when the adapter says nothing', async () => {
    const silent = new DemoObdTransport();
    await silent.connect('demo');
    // Swallow the request so nothing ever comes back.
    silent.write = async () => {};
    const client = new ObdClient(silent, {commandTimeoutMs: 50});

    await expect(client.send('010C')).rejects.toThrow(/Timed out/);
    await client.close();
  });
});
