import type {DiagnosticCode, Telemetry} from '../../core/types';
import {utf8Decode, utf8Encode} from '../ktm/framing';
import type {Transport} from '../../transport/types';
import {
  INIT_COMMANDS,
  isComplete,
  parseDtcs,
  parsePidData,
  parseResponse,
} from './elm327';
import {PIDS, decodeSupportMask, type PidDefinition} from './pids';

export interface ObdClientOptions {
  /** How long to wait for a reply before giving up on a command. */
  commandTimeoutMs?: number;
  /** Gap between poll cycles; the adapter needs a breather between requests. */
  pollIntervalMs?: number;
  /** Poll the slow group (temperatures, voltage) every N cycles. */
  slowEvery?: number;
  onLog?: (line: string) => void;
}

const DEFAULTS = {
  commandTimeoutMs: 4000,
  pollIntervalMs: 120,
  slowEvery: 10,
};

/**
 * Talks OBD-II to the bike through an ELM327 adapter.
 *
 * The adapter answers one command at a time, so every request goes through a
 * queue: write the command, collect bytes until the '>' prompt comes back, hand
 * the text to the parser. A PID that fails twice is dropped for the rest of the
 * session, which keeps the poll loop fast on ECUs that only answer a handful.
 */
export class ObdClient {
  private options: Required<Omit<ObdClientOptions, 'onLog'>> & Pick<ObdClientOptions, 'onLog'>;
  private buffer = '';
  private pending: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private polling = false;
  private supported: PidDefinition[] = [];
  private failures = new Map<string, number>();

  constructor(private transport: Transport, options: ObdClientOptions = {}) {
    this.options = {...DEFAULTS, ...options};
  }

  /** PIDs this ECU answered during probing. */
  get activePids(): PidDefinition[] {
    return this.supported;
  }

  /**
   * Reset the adapter, turn off echo, and find out which PIDs the ECU answers.
   * Assumes the transport is already connected.
   */
  async initialize(): Promise<PidDefinition[]> {
    this.buffer = '';
    this.unsubscribe?.();
    this.unsubscribe = this.transport.onData(chunk => this.ingest(chunk));

    for (const command of INIT_COMMANDS) {
      // ATZ reboots the adapter and answers slowly; failures here are not fatal
      // because some clones skip commands they do not implement.
      await this.send(command).catch(error => {
        this.log(`init ${command} failed: ${String(error)}`);
        return '';
      });
    }

    this.supported = await this.probeSupportedPids();
    this.failures.clear();
    return this.supported;
  }

  /** Ask the ECU which PIDs it will answer, falling back to trying them all. */
  private async probeSupportedPids(): Promise<PidDefinition[]> {
    const available = new Set<string>();
    for (const base of [0x00, 0x20, 0x40]) {
      const pid = base.toString(16).toUpperCase().padStart(2, '0');
      const response = parseResponse(await this.send(`01${pid}`).catch(() => ''));
      const data = parsePidData(response, pid);
      if (!data || data.length < 4) {
        break;
      }
      decodeSupportMask(base, data).forEach(code => available.add(code));
      // Bit 32 of each mask says whether the next range is supported.
      if (!available.has((base + 0x20).toString(16).toUpperCase().padStart(2, '0'))) {
        break;
      }
    }

    if (available.size === 0) {
      this.log('ECU did not answer the support PIDs; polling everything instead');
      return PIDS;
    }
    const supported = PIDS.filter(pid => available.has(pid.pid));
    this.log(`ECU supports ${supported.length}/${PIDS.length} of the PIDs we display`);
    return supported.length > 0 ? supported : PIDS;
  }

  /**
   * Poll until `stop()` is called, handing a fresh snapshot to `onUpdate` after
   * every cycle.
   */
  async start(onUpdate: (telemetry: Telemetry) => void): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    let cycle = 0;

    while (this.polling && this.transport.isConnected) {
      const includeSlow = cycle % this.options.slowEvery === 0;
      const group = this.supported.filter(pid => includeSlow || pid.rate === 'fast');
      const snapshot: Telemetry = {};

      for (const pid of group) {
        if (!this.polling) {
          break;
        }
        const value = await this.readPid(pid);
        if (value != null) {
          snapshot[pid.key] = value;
        }
      }

      if (Object.keys(snapshot).length > 0) {
        snapshot.updatedAt = Date.now();
        onUpdate(snapshot);
      }

      cycle += 1;
      await delay(this.options.pollIntervalMs);
    }
    this.polling = false;
  }

  stop(): void {
    this.polling = false;
  }

  async readPid(pid: PidDefinition): Promise<number | null> {
    if ((this.failures.get(pid.pid) ?? 0) >= 2) {
      return null;
    }
    try {
      const response = parseResponse(await this.send(`01${pid.pid}`));
      const data = parsePidData(response, pid.pid);
      if (!data || data.length < pid.bytes) {
        this.noteFailure(pid);
        return null;
      }
      this.failures.delete(pid.pid);
      return round(pid.decode(data));
    } catch (error) {
      this.noteFailure(pid);
      this.log(`read ${pid.pid} failed: ${String(error)}`);
      return null;
    }
  }

  /** Stored diagnostic trouble codes (service 03). */
  async readDiagnosticCodes(): Promise<DiagnosticCode[]> {
    const response = parseResponse(await this.send('03'));
    return parseDtcs(response).map(code => ({code, raw: response.lines.join(' ')}));
  }

  /** Send a raw command; exposed for the terminal in the diagnostics screen. */
  send(command: string): Promise<string> {
    const run = () => this.sendNow(command);
    const result = this.chain.then(run, run);
    // Keep the chain alive even when a command rejects.
    this.chain = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    this.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.rejectPending(new Error('Closed'));
  }

  private sendNow(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.buffer = '';
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Timed out waiting for a reply to ${command}`));
      }, this.options.commandTimeoutMs);

      this.pending = {resolve, reject, timer};
      this.transport.write(utf8Encode(`${command}\r`)).catch(error => {
        clearTimeout(timer);
        this.pending = null;
        reject(error);
      });
    });
  }

  private ingest(chunk: Uint8Array): void {
    this.buffer += utf8Decode(chunk);
    if (!this.pending || !isComplete(this.buffer)) {
      return;
    }
    const {resolve, timer} = this.pending;
    clearTimeout(timer);
    this.pending = null;
    const response = this.buffer;
    this.buffer = '';
    resolve(response);
  }

  private rejectPending(error: Error): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }

  private noteFailure(pid: PidDefinition): void {
    const count = (this.failures.get(pid.pid) ?? 0) + 1;
    this.failures.set(pid.pid, count);
    if (count >= 2) {
      this.log(`dropping PID ${pid.pid} (${pid.label}) — the ECU does not answer it`);
    }
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
