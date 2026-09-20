import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

const CANCELLATION_DELIVERY_TIMEOUT_MS = 30_000;

/** Give SDK cancellation delivery its existing allowance before per-call transport cleanup. */
export class CancellationDeliveryTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  private readonly cancellationDeliveries = new Set<Promise<'delivered' | 'failed'>>();
  private cancellationFailed = false;
  private cancellationRequested = false;

  constructor(private readonly inner: Transport) {}

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  async start(): Promise<void> {
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onmessage = (message, extra) => this.onmessage?.(message, extra);
    await this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const delivery = this.inner.send(message, options);
    if ('method' in message && message.method === 'notifications/cancelled') {
      this.cancellationRequested = true;
      const settled = delivery.then(
        () => 'delivered',
        () => 'failed'
      ) as Promise<'delivered' | 'failed'>;
      this.cancellationDeliveries.add(settled);
      void settled.then((result) => {
        if (result === 'failed') this.cancellationFailed = true;
        this.cancellationDeliveries.delete(settled);
      });
    }
    return delivery;
  }

  async waitForCancellationDelivery(): Promise<
    'not-requested' | 'delivered' | 'failed' | 'timed-out'
  > {
    if (!this.cancellationRequested) return 'not-requested';
    const delivery = (async () => {
      while (this.cancellationDeliveries.size) {
        await Promise.all([...this.cancellationDeliveries]);
      }
      return this.cancellationFailed ? ('failed' as const) : ('delivered' as const);
    })();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        delivery,
        new Promise<'timed-out'>((resolve) => {
          deadline = setTimeout(() => resolve('timed-out'), CANCELLATION_DELIVERY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}
