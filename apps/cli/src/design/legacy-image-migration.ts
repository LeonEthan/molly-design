import { randomUUID } from 'node:crypto';
import {
  LegacyImageCredentialSchema,
  type LegacyImageCredential,
} from '@molly/shared/embedded-harness';

/** Main-host-only two-phase handoff. No acknowledgement, no removal of the old row. */
export class LegacyImageMigration {
  private pending?: { requestId: string; connection: LegacyImageCredential };
  private serial: Promise<unknown> = Promise.resolve();

  exchange(
    acknowledgement: string | undefined,
    ports: {
      read: () => Promise<unknown>;
      clearIfEqual: (expected: LegacyImageCredential) => Promise<void>;
    }
  ) {
    const operation = async () => {
      if (this.pending && acknowledgement === this.pending.requestId) {
        await ports.clearIfEqual(this.pending.connection);
        this.pending = undefined;
      }
      const parsed = LegacyImageCredentialSchema.safeParse(await ports.read());
      if (!parsed.success) {
        this.pending = undefined;
        return undefined;
      }
      if (!this.pending || JSON.stringify(this.pending.connection) !== JSON.stringify(parsed.data))
        this.pending = { requestId: randomUUID(), connection: parsed.data };
      return structuredClone(this.pending);
    };
    const result = this.serial.then(operation, operation);
    this.serial = result.catch(() => undefined);
    return result;
  }
}
