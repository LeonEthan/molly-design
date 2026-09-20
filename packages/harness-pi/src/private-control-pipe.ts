import type { Readable } from 'node:stream';

/** Private parent-owned FD only. Deliberately has no diagnostics or payload logging. */
export class PrivateControlPipe {
  private buffer = Buffer.alloc(0);
  private readonly queue: unknown[] = [];
  private waiter?: { resolve(value: unknown): void; reject(error: Error): void };
  private failed = false;
  constructor(private readonly stream: Readable) {
    stream.on('data', (chunk: Buffer) => {
      try {
        if (this.failed) return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > 1024 * 1024) throw new Error('harness_control_limit');
        let newline: number;
        while ((newline = this.buffer.indexOf(10)) >= 0) {
          const packet = this.buffer.subarray(0, newline);
          const value: unknown = JSON.parse(packet.toString('utf8'));
          packet.fill(0);
          this.buffer = this.buffer.subarray(newline + 1);
          if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = undefined;
            waiter.resolve(value);
          } else {
            this.queue.push(value);
            if (this.queue.length > 8) throw new Error('harness_control_limit');
          }
        }
      } catch {
        this.close();
      }
    });
    stream.on('error', () => this.close());
    stream.on('end', () => this.close());
  }
  read(signal?: AbortSignal): Promise<unknown> {
    if (this.failed || signal?.aborted) return Promise.reject(new Error('harness_control_closed'));
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.waiter) return Promise.reject(new Error('harness_control_concurrent_read'));
    return new Promise((resolve, reject) => {
      const abort = () => this.close();
      signal?.addEventListener('abort', abort, { once: true });
      this.waiter = {
        resolve: (value) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      };
    });
  }
  close(): void {
    if (this.failed) return;
    this.failed = true;
    this.buffer.fill(0);
    this.buffer = Buffer.alloc(0);
    this.queue.length = 0;
    this.waiter?.reject(new Error('harness_control_closed'));
    this.waiter = undefined;
    this.stream.destroy();
  }
}
