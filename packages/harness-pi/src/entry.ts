import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createWorkerEnvironment } from './environment';
import { WorkerConfigSchema } from './worker-config';
import { PrivateControlPipe } from './private-control-pipe';
import { prepareProfile } from './profile';
import { writeProfileSettings } from './profile-settings';

/** Packaging check: the sealed SDK and every Pi package resolve, without a profile or key. */
async function probe() {
  const { ModelRuntime, VERSION } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  const { createProfileSettings } = await import('./profile-settings');
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  return {
    schemaVersion: 1,
    engineVersion: VERSION,
    protocolVersion: 1,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    modelCount: runtime.getModels().length,
    packages: createProfileSettings().packages.length,
  };
}

async function main(): Promise<void> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!major || major < 22 || (major === 22 && (!minor || minor < 19)))
    throw new Error('harness_node_version_unsupported');
  if (process.argv[2] === '--probe') {
    process.stdout.write(`${JSON.stringify(await probe())}\n`);
    return;
  }
  // Secrets are never part of startup args/env or ACP messages.
  const control = new PrivateControlPipe(createReadStream('', { fd: 3, autoClose: true }));
  try {
    const parsed = WorkerConfigSchema.safeParse(await control.read());
    if (!parsed.success) throw new Error('harness_bootstrap_invalid');
    const config = parsed.data;
    const manifest = JSON.parse(
      await readFile(new URL('./runtime-manifest.json', import.meta.url), 'utf8')
    );
    if (
      manifest.buildId !== config.harness.buildId ||
      manifest.engineVersion !== config.harness.engineVersion ||
      manifest.protocolVersion !== config.harness.protocolVersion
    )
      throw new Error('harness_build_mismatch');
    const environment = createWorkerEnvironment(process.env, config.privateRoot);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environment);
    await mkdir(environment.TMPDIR!, { recursive: true, mode: 0o700 });
    // Pi and its packages resolve the profile through the process-wide agent directory.
    const agentDir = await prepareProfile(environment.PI_CODING_AGENT_DIR!);
    await writeProfileSettings(agentDir);
    const { PiAcpAgent } = await import('./agent');
    const { PiAcpHost } = await import('./host');
    let agent: InstanceType<typeof PiAcpAgent> | undefined;
    const connection = new AgentSideConnection(
      (peer) => {
        agent = new PiAcpAgent(peer, { agentDir, host: new PiAcpHost(config, control, peer) });
        return agent;
      },
      ndJsonStream(
        Writable.toWeb(process.stdout),
        Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
      )
    );
    process.once('SIGTERM', () => {
      void Promise.resolve(agent?.dispose()).finally(() => process.exit(0));
    });
    try {
      await connection.closed;
    } finally {
      await agent?.dispose();
    }
  } finally {
    control.close();
  }
}

main().catch(() => {
  // Input and vendor exceptions may contain credentials. Diagnostic codes only.
  process.stderr.write('molly_harness_worker_failed\n');
  process.exitCode = 1;
});
