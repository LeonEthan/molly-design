import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerEnvironment } from './environment';
import {
  WorkerConfigSchema,
  WorkerCredentialGrantSchema,
  WorkerMcpCredentialGrantSchema,
} from './worker-config';
import { PrivateControlPipe } from './private-control-pipe';

function isolate(root: string): void {
  const environment = createWorkerEnvironment(process.env, root);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
}

async function main(): Promise<void> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!major || major < 22 || (major === 22 && (!minor || minor < 19)))
    throw new Error('harness_node_version_unsupported');
  if (process.argv[2] === '--probe') {
    const privateRoot = await mkdtemp(join(tmpdir(), 'molly-pi-probe-'));
    try {
      isolate(privateRoot);
      const { probeWorker } = await import('./worker-main');
      process.stdout.write(`${JSON.stringify(await probeWorker())}\n`);
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
    return;
  }
  // The parent writes public bootstrap, then run-bound grants over an extra FD.
  // Secrets are never part of startup args/env, ACP messages or config files.
  const control = new PrivateControlPipe(createReadStream('', { fd: 3, autoClose: true }));
  try {
    const parsed = WorkerConfigSchema.safeParse(await control.read());
    if (!parsed.success) throw new Error('harness_bootstrap_invalid');
    const manifest = JSON.parse(
      await readFile(new URL('./runtime-manifest.json', import.meta.url), 'utf8')
    );
    if (
      manifest.buildId !== parsed.data.harness.buildId ||
      manifest.engineVersion !== parsed.data.harness.engineVersion ||
      manifest.protocolVersion !== parsed.data.harness.protocolVersion
    )
      throw new Error('harness_build_mismatch');
    isolate(parsed.data.privateRoot);
    await mkdir(join(parsed.data.privateRoot, 'tmp'), { recursive: true, mode: 0o700 });
    const { runWorker } = await import('./worker-main');
    await runWorker(
      parsed.data,
      async (snapshot, signal) => {
        const grant = WorkerCredentialGrantSchema.safeParse(await control.read(signal));
        if (
          !grant.success ||
          grant.data.runId !== snapshot.runId ||
          grant.data.runtimeEpoch !== snapshot.runtimeEpoch
        ) {
          throw new Error('harness_credential_grant_mismatch');
        }
        return grant.data.apiKey;
      },
      async (preparation, signal) => {
        const grant = WorkerMcpCredentialGrantSchema.safeParse(await control.read(signal));
        if (
          !grant.success ||
          grant.data.runId !== preparation.runId ||
          grant.data.runtimeEpoch !== preparation.runtimeEpoch ||
          JSON.stringify(grant.data.credentials.map((entry) => entry.connection)) !==
            JSON.stringify(preparation.mcpConnections)
        )
          throw new Error('harness_mcp_credential_grant_mismatch');
        return grant.data.credentials;
      }
    );
  } finally {
    control.close();
  }
}

main().catch(() => {
  // Input and vendor exceptions may contain credentials. Diagnostic codes only.
  process.stderr.write('molly_harness_worker_failed\n');
  process.exitCode = 1;
});
