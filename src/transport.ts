import { OpsdkError } from './errors.js';
import { HostError } from './protocol.js';

export interface Transport {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  close?(): Promise<void> | void;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class ByteStream {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private waiter: (() => void) | null = null;
  private closed = false;
  private error: unknown = null;
  private lost: (Error & { lost?: boolean }) | null = null;

  constructor(private readonly transport: Transport) {
    void this.pump();
  }

  private async pump(): Promise<void> {
    for (;;) {
      let chunk: Uint8Array | null;
      try {
        chunk = await this.transport.read();
      } catch (e) {
        // lost bytes (serial overrun) fail the pending read only, keep pumping
        if (!(e as { lost?: boolean })?.lost) {
          this.error = e;
          break;
        }
        this.lost = e as Error;
        this.wake();
        continue;
      }
      if (!chunk) break;
      if (chunk.length) {
        this.chunks.push(chunk);
        this.length += chunk.length;
        this.wake();
      }
    }
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    if (w) w();
  }

  private waitData(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(
        () => {
          this.waiter = null;
          resolve();
        },
        Math.max(0, ms)
      );
      this.waiter = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - o);
      out.set(c.subarray(0, k), o);
      o += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.length -= n;
    return out;
  }

  async read(n: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.length < n) {
      if (this.lost) {
        const e = this.lost;
        this.lost = null;
        throw new OpsdkError(`received data was lost (${e.message})`, {
          code: HostError.IO,
          lost: true,
          cause: e,
        });
      }
      if (this.closed) {
        const reason = this.error ? errorText(this.error) : 'end of stream';
        throw new OpsdkError(`connection closed: ${reason}`, {
          code: HostError.IO,
          cause: this.error ?? undefined,
        });
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new OpsdkError('no answer from the device', { code: HostError.TIMEOUT });
      await this.waitData(left);
    }
    return this.take(n);
  }

  get available(): number {
    return this.length;
  }

  // throw away input until the line has been quiet for quietMs
  async drain(quietMs: number): Promise<number> {
    let total = 0;
    for (;;) {
      if (this.length) {
        total += this.length;
        this.take(this.length);
      }
      this.lost = null;
      if (!quietMs || this.closed) return total;
      await this.waitData(quietMs);
      if (!this.length) return total;
    }
  }
}
