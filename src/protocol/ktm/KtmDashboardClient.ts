import type {Transport} from '../../transport/types';
import {concatBytes, decodeFrames, encodeFrame} from './framing';
import {
  restoreView,
  serializeMessage,
  type DashboardView,
} from './messages';

export interface KtmDashboardOptions {
  onLog?: (line: string) => void;
  /** Anything the dashboard sends back, decoded from its frames. */
  onMessage?: (payload: string) => void;
}

/**
 * Draws on the bike's TFT display over the MY RIDE link.
 *
 * The display keeps whatever was last sent, so the client remembers the
 * current view: repainting after a reconnect is just re-sending it, and hiding
 * everything is sending the restore view.
 */
export class KtmDashboardClient {
  private sequence = 0;
  private view: DashboardView = restoreView();
  private inbound: Uint8Array = new Uint8Array(0);
  private unsubscribe: (() => void) | null = null;

  constructor(private transport: Transport, private options: KtmDashboardOptions = {}) {}

  /** The view currently on the display. */
  get currentView(): DashboardView {
    return this.view;
  }

  /**
   * Say hello. The display ignores the first message after a socket opens often
   * enough that the reference implementation sends two; we do the same.
   */
  async handshake(): Promise<void> {
    this.sequence = 0;
    this.unsubscribe?.();
    this.unsubscribe = this.transport.onData(chunk => this.ingest(chunk));
    await this.show(restoreView());
    await this.show(restoreView());
  }

  /** Push a view and remember it. */
  async show(view: DashboardView): Promise<void> {
    const payload = serializeMessage(view, this.sequence++);
    this.options.onLog?.(`→ ${payload}`);
    await this.transport.write(encodeFrame(payload));
    this.view = view;
  }

  /** Hand the screen back to the bike's own display. */
  async restore(): Promise<void> {
    await this.show(restoreView());
  }

  /** Re-send the current view, e.g. after the link came back. */
  async repaint(): Promise<void> {
    await this.show(this.view);
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.inbound = new Uint8Array(0);
  }

  private ingest(chunk: Uint8Array): void {
    this.inbound = concatBytes(this.inbound, chunk);
    try {
      const {frames, rest} = decodeFrames(this.inbound);
      this.inbound = rest;
      frames.forEach(frame => {
        this.options.onLog?.(`← ${frame.payload}`);
        this.options.onMessage?.(frame.payload);
      });
    } catch {
      // A desynchronised stream never recovers on its own; drop what we have.
      this.options.onLog?.(`← dropped ${this.inbound.length} unparseable bytes`);
      this.inbound = new Uint8Array(0);
    }
  }
}
