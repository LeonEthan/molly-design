import { randomUUID } from 'node:crypto';
import {
  HarnessRunSnapshotSchema,
  HarnessHostExchangeSchema,
  type HarnessRunSnapshot,
  type ModelConnection,
  type HarnessCredentialRequest,
  type ProtectedImageConnection,
  HarnessMcpPreparationSchema,
  StoredMcpCredentialSchema,
  type HarnessMcpPreparation,
  type HarnessMcpCredentialRequest,
  type McpCredentialBinding,
} from '@molly/shared/embedded-harness';

type McpLease = {
  request: HarnessMcpCredentialRequest;
  active: () => boolean;
  revoke: () => void;
  signal: AbortSignal;
  abort: () => void;
  resolve: (value: ReturnType<typeof StoredMcpCredentialSchema.parse>) => void;
  acquired: boolean;
};

type Lease = {
  request: HarnessCredentialRequest;
  active: () => boolean;
  revoke: () => void;
  signal: AbortSignal;
  abort: () => void;
  resolve: (key: string) => void;
  reject: (error: Error) => void;
  acquired: boolean;
  credential?: Promise<string>;
};

/** No caller-supplied credentialRef API. Only the Session dispatcher creates leases. */
export class HarnessCredentialBroker {
  private connections: ModelConnection[] = [];
  private imageConnection: ProtectedImageConnection | null = null;
  private readonly leases = new Map<string, Lease>();
  private mcpConnections: McpCredentialBinding[] = [];
  private readonly mcpLeases = new Map<string, McpLease>();
  private hostDeadline?: ReturnType<typeof setTimeout>;

  dispose(): void {
    if (this.hostDeadline) clearTimeout(this.hostDeadline);
    this.hostDeadline = undefined;
    this.connections = [];
    this.imageConnection = null;
    this.mcpConnections = [];
    for (const lease of [...this.mcpLeases.values()]) {
      lease.signal.removeEventListener('abort', lease.abort);
      lease.abort();
      lease.revoke();
    }
    for (const lease of [...this.leases.values()]) {
      lease.signal.removeEventListener('abort', lease.abort);
      lease.abort();
      lease.revoke();
    }
  }

  catalog(): ModelConnection[] {
    return structuredClone(this.connections);
  }

  imageCatalog(): ProtectedImageConnection | null {
    return structuredClone(this.imageConnection);
  }

  mcpCatalog(): McpCredentialBinding[] {
    return structuredClone(this.mcpConnections);
  }

  pendingMcpRequests(): HarnessMcpCredentialRequest[] {
    return [...this.mcpLeases.values()]
      .filter((lease) => !lease.acquired)
      .slice(0, 8)
      .map((lease) => structuredClone(lease.request));
  }

  acquireMcp(
    input: HarnessMcpPreparation,
    options: { signal: AbortSignal; active: () => boolean; revoke: () => void }
  ) {
    const preparation = HarnessMcpPreparationSchema.parse(input);
    if (options.signal.aborted || !options.active()) throw new Error('harness_run_retired');
    const current = this.connections.find(
      (connection) => connection.id === preparation.connection.id
    );
    if (
      !current?.enabled ||
      JSON.stringify(current) !== JSON.stringify(preparation.connection) ||
      preparation.mcpConnections.some(
        (binding) =>
          !this.mcpConnections.some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(binding)
          )
      )
    )
      throw new Error('harness_mcp_credential_unavailable');
    if (this.mcpLeases.size + preparation.mcpConnections.length > 64)
      throw new Error('harness_credential_queue_full');
    const ids: string[] = [];
    const credentials = Promise.all(
      preparation.mcpConnections.map((connection) => {
        const request = { requestId: randomUUID(), preparation, connection };
        ids.push(request.requestId);
        return new Promise<ReturnType<typeof StoredMcpCredentialSchema.parse>>(
          (resolve, reject) => {
            const abort = () => {
              this.mcpLeases.delete(request.requestId);
              reject(new Error('harness_run_retired'));
            };
            this.mcpLeases.set(request.requestId, {
              request,
              ...options,
              abort,
              resolve,
              acquired: false,
            });
            options.signal.addEventListener('abort', abort, { once: true });
          }
        );
      })
    );
    return {
      credentials,
      release: () => {
        for (const id of ids) {
          const lease = this.mcpLeases.get(id);
          if (!lease) continue;
          lease.signal.removeEventListener('abort', lease.abort);
          lease.abort();
        }
      },
    };
  }

  /** Resolve the active model run ourselves, never a renderer-selected credential reference. */
  async acquireImageForSession(sessionId: string) {
    const parent = [...this.leases.values()].find(
      (lease) =>
        !lease.request.imageConnection &&
        lease.acquired &&
        lease.active() &&
        !lease.signal.aborted &&
        lease.request.snapshot.sessionId === sessionId
    );
    const connection = parent?.request.snapshot.imageConnection;
    if (
      !parent ||
      !connection?.enabled ||
      !connection.hasApiKey ||
      JSON.stringify(connection) !== JSON.stringify(this.imageConnection)
    )
      throw new Error('image_connection_unavailable');
    const existing = [...this.leases.values()].find(
      (lease) =>
        lease.active() &&
        lease.request.snapshot.runId === parent.request.snapshot.runId &&
        lease.request.snapshot.runtimeEpoch === parent.request.snapshot.runtimeEpoch &&
        JSON.stringify(lease.request.imageConnection) === JSON.stringify(connection)
    );
    if (existing?.credential) return { connection, apiKey: await existing.credential };
    const lease = this.acquire(
      parent.request.snapshot,
      {
        signal: parent.signal,
        active: () => this.leases.has(parent.request.requestId) && parent.active(),
        revoke: parent.revoke,
      },
      connection
    );
    // Retain the lease until its parent ends so a revocation stops the owning worker.
    return { connection, apiKey: await lease.credential };
  }

  acquire(
    snapshotInput: HarnessRunSnapshot,
    options: { signal: AbortSignal; active: () => boolean; revoke: () => void },
    imageConnection?: ProtectedImageConnection
  ) {
    const snapshot = HarnessRunSnapshotSchema.parse(snapshotInput);
    if (options.signal.aborted || !options.active()) throw new Error('harness_run_retired');
    const connection = this.connections.find(
      (candidate) => candidate.id === snapshot.connection.id
    );
    if (
      !connection?.enabled ||
      JSON.stringify(connection) !== JSON.stringify(snapshot.connection) ||
      (snapshot.imageConnection &&
        JSON.stringify(snapshot.imageConnection) !== JSON.stringify(this.imageConnection))
    ) {
      throw new Error('harness_connection_unavailable');
    }
    if (this.leases.size >= 64) throw new Error('harness_credential_queue_full');
    const request: HarnessCredentialRequest = {
      requestId: randomUUID(),
      snapshot,
      ...(imageConnection ? { imageConnection } : {}),
    };
    const credential = new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.leases.delete(request.requestId);
        reject(new Error('harness_run_retired'));
      };
      this.leases.set(request.requestId, {
        request,
        ...options,
        abort,
        resolve,
        reject,
        acquired: false,
      });
      options.signal.addEventListener('abort', abort, { once: true });
    });
    const release = () => {
      for (const lease of [...this.leases.values()]) {
        if (
          lease.request.requestId !== request.requestId &&
          (request.imageConnection ||
            !lease.request.imageConnection ||
            lease.request.snapshot.runId !== snapshot.runId ||
            lease.request.snapshot.runtimeEpoch !== snapshot.runtimeEpoch)
        )
          continue;
        lease.signal.removeEventListener('abort', lease.abort);
        lease.abort();
      }
    };
    const lease = this.leases.get(request.requestId);
    if (lease) lease.credential = credential;
    return { credential, release };
  }

  exchange(input: ReturnType<typeof HarnessHostExchangeSchema.parse>): HarnessCredentialRequest[] {
    const parsed = HarnessHostExchangeSchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid_harness_host_exchange');
    if (this.hostDeadline) clearTimeout(this.hostDeadline);
    this.hostDeadline = setTimeout(() => this.dispose(), 10_000);
    this.hostDeadline.unref?.();
    this.connections = parsed.data.connections;
    this.imageConnection = parsed.data.imageConnection ?? null;
    this.mcpConnections = parsed.data.mcpConnections ?? [];
    for (const lease of [...this.mcpLeases.values()]) {
      const preparation = lease.request.preparation;
      if (
        !lease.active() ||
        lease.signal.aborted ||
        !this.connections.some(
          (connection) =>
            connection.enabled &&
            JSON.stringify(connection) === JSON.stringify(preparation.connection)
        ) ||
        !this.mcpConnections.some(
          (connection) => JSON.stringify(connection) === JSON.stringify(lease.request.connection)
        )
      ) {
        lease.signal.removeEventListener('abort', lease.abort);
        lease.abort();
        lease.revoke();
      }
    }
    for (const report of parsed.data.mcpReports ?? []) {
      const lease = this.mcpLeases.get(report.requestId);
      if (!lease || lease.acquired || !lease.active() || lease.signal.aborted) continue;
      if (
        report.runId !== lease.request.preparation.runId ||
        report.runtimeEpoch !== lease.request.preparation.runtimeEpoch ||
        report.credentialRef !== lease.request.connection.credentialRef ||
        report.credentialRevision !== lease.request.connection.revision
      )
        continue;
      const credential =
        report.result.ok &&
        StoredMcpCredentialSchema.safeParse({
          connection: lease.request.connection,
          values: report.result.values,
        });
      if (!credential || !credential.success) {
        lease.signal.removeEventListener('abort', lease.abort);
        lease.abort();
      } else {
        lease.acquired = true;
        lease.resolve(credential.data);
      }
    }
    for (const lease of [...this.leases.values()]) {
      const current = this.connections.find(
        (connection) => connection.id === lease.request.snapshot.connection.id
      );
      const image = lease.request.imageConnection;
      if (
        !current?.enabled ||
        JSON.stringify(current) !== JSON.stringify(lease.request.snapshot.connection) ||
        (lease.request.snapshot.imageConnection &&
          JSON.stringify(lease.request.snapshot.imageConnection) !==
            JSON.stringify(this.imageConnection)) ||
        (image && JSON.stringify(image) !== JSON.stringify(this.imageConnection)) ||
        !lease.active()
      ) {
        lease.signal.removeEventListener('abort', lease.abort);
        lease.abort();
        lease.revoke();
      }
    }
    for (const report of parsed.data.reports) {
      const lease = this.leases.get(report.requestId);
      if (!lease || lease.acquired || lease.signal.aborted || !lease.active()) continue;
      const snapshot = lease.request.snapshot;
      if (
        report.runId !== snapshot.runId ||
        report.runtimeEpoch !== snapshot.runtimeEpoch ||
        report.connectionId !== snapshot.connection.id ||
        report.connectionRevision !== snapshot.connection.revision ||
        report.imageConnectionId !== lease.request.imageConnection?.id ||
        report.imageConnectionRevision !== lease.request.imageConnection?.revision
      )
        continue;
      if (!report.result.ok) {
        lease.signal.removeEventListener('abort', lease.abort);
        lease.abort();
      } else {
        lease.acquired = true;
        lease.resolve(report.result.apiKey);
      }
    }
    const pending = [...this.leases.values()].filter((lease) => !lease.acquired).slice(0, 8);
    // Redelivery only retries credential handoff, never model/tool dispatch.
    return pending.map((lease) => lease.request);
  }
}
