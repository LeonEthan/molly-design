import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { verifyEmbeddedHarness } from './verify-embedded-harness.mjs';
import { createSyntheticTurnBenchmark } from './packaged-turn-benchmark.mjs';

// Offline package smoke only. Protected mode uses a synthetic key and local discovery,
// never a paid tool call or user credential. Optional turn exercises contact only
// the local synthetic peer; the default path does not prompt a model.
const execute = promisify(execFile);

async function workerRssKiB(child) {
  assert.ok(child.pid && child.exitCode === null && child.signalCode === null);
  // Observational benchmark only, not a timing assertion in the unit suite.
  const { stdout } = await execute('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)]);
  const rss = Number(stdout.trim());
  assert.ok(Number.isFinite(rss) && rss > 0, 'worker RSS unavailable');
  return rss;
}

async function workerResources(child) {
  const rssKiB = await workerRssKiB(child);
  if (platform() !== 'darwin') return { rssKiB };
  // Field-only output: do not collect paths, socket destinations or file contents.
  const { stdout } = await execute('/usr/sbin/lsof', ['-a', '-p', String(child.pid), '-F', 'f'], {
    timeout: 5000,
    maxBuffer: 64_000,
  });
  const fileDescriptorCount = stdout.split('\n').filter((line) => /^f\d/.test(line)).length;
  assert.ok(fileDescriptorCount > 0, 'worker descriptor observation unavailable');
  return { rssKiB, fileDescriptorCount };
}

async function observeCollectedMemory(child, includeCounts) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('synthetic_memory_observation_timeout')),
      5000
    );
    const finish = (error, value) => {
      clearTimeout(timeout);
      child.off('message', received);
      child.off('exit', exited);
      error ? reject(error) : resolve(value);
    };
    const exited = () => finish(new Error('synthetic_worker_exited_before_observation'));
    const received = (message) => {
      if (message?.type !== 'synthetic-memory-observation' || message.id !== id) return;
      try {
        const fields = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'];
        for (const phase of ['before', 'after']) {
          assert.deepEqual(Object.keys(message[phase]).sort(), fields.toSorted());
          assert.ok(
            fields.every(
              (field) => Number.isFinite(message[phase][field]) && message[phase][field] >= 0
            )
          );
        }
        if (includeCounts) {
          // This fixed worker owns exactly one active native session/runtime.
          // This lifecycle assertion is not an arbitrary memory-size threshold.
          assert.deepEqual(message.counts, { agentSessions: 1, modelRuntimes: 1 });
        } else assert.equal(message.counts, undefined);
        finish(undefined, { before: message.before, after: message.after, counts: message.counts });
      } catch {
        finish(new Error('synthetic_memory_observation_invalid'));
      }
    };
    child.on('message', received);
    child.once('exit', exited);
    child.send({ type: 'synthetic-memory-observation', id, includeCounts }, (error) => {
      if (error) finish(error);
    });
  });
}

export async function runPackagedSmoke({
  output,
  executable,
  protectedMcp = false,
  questionUI = false,
  compatibleModel = false,
  measure = false,
  exerciseTurns = 0,
  diagnoseGc = false,
}) {
  if (measure && !['darwin', 'linux'].includes(platform()))
    throw new Error('RSS benchmark requires native macOS or Linux');
  assert.ok(Number.isInteger(exerciseTurns) && exerciseTurns >= 0 && exerciseTurns <= 50);
  if (exerciseTurns)
    assert.ok(
      measure && compatibleModel,
      'Turn exercises require --measure and --compatible-model'
    );
  if (diagnoseGc) assert.ok(exerciseTurns > 0, 'GC diagnosis requires synthetic turn exercises');
  const manifest = verifyEmbeddedHarness(path.join(output, 'harness'));
  const root = await mkdtemp(path.join(tmpdir(), 'molly-harness-package-smoke-'));
  let child;
  let benchmark;
  let turns = [];
  const timings = {};
  const memory = {};
  try {
    if (exerciseTurns) benchmark = await createSyntheticTurnBenchmark(exerciseTurns);
    const cwd = path.join(root, 'workspace');
    await mkdir(path.join(cwd, '.pi'), { recursive: true });
    const pollution = '{invalid project Pi config: must not be read}';
    await writeFile(path.join(cwd, '.pi', 'settings.json'), pollution);
    const launchedAt = performance.now();
    child = spawn(
      executable,
      [
        ...(diagnoseGc
          ? [
              '--expose-gc',
              '--require',
              fileURLToPath(new URL('./diagnostics/gc-observer.cjs', import.meta.url)),
            ]
          : []),
        path.join(output, 'molly-pi-agent.js'),
      ],
      {
        cwd,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: root,
          LANG: 'en_US.UTF-8',
          ELECTRON_RUN_AS_NODE: '1',
          PI_CODING_AGENT_DIR: '/does-not-exist/pi',
          OPENAI_API_KEY: 'SYNTHETIC_POLLUTION_CANARY',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', ...(diagnoseGc ? ['ipc'] : [])],
      }
    );
    const exit = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', () => resolve(-1));
    });
    child.stdio[3].on('error', () => undefined);
    await once(child, 'spawn');
    timings.processSpawnMs = performance.now() - launchedAt;
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const config = {
      schemaVersion: 1,
      runtimeEpoch: randomUUID(),
      productSessionId: 'synthetic-package-smoke',
      workspaceId: 'synthetic-workspace',
      harness: {
        id: 'molly',
        engine: 'pi',
        engineVersion: manifest.engineVersion,
        buildId: manifest.buildId,
        protocolVersion: 1,
      },
      cwd,
      privateRoot: path.join(root, 'private'),
      shellPath: '/bin/sh',
      connection: {
        schemaVersion: 1,
        id: 'synthetic-connection',
        revision: 1,
        providerPresetId: compatibleModel ? 'openai-compatible' : 'openai',
        displayName: 'Synthetic',
        baseUrl: benchmark?.baseUrl ?? 'https://example.invalid/v1',
        credentialRef: 'unavailable-synthetic-ref',
        enabled: true,
        ...(compatibleModel
          ? {
              customModels: [
                {
                  modelId: 'synthetic/custom',
                  name: 'Synthetic custom model',
                  input: ['text', 'image'],
                  contextWindow: 32768,
                  maxTokens: 4096,
                  thinking: ['off', 'high'],
                  toolCalls: true,
                  usageInStreaming: true,
                  maxTokensField: 'max_tokens',
                },
              ],
            }
          : {}),
      },
      selection: {
        connectionId: 'synthetic-connection',
        modelId: compatibleModel ? 'synthetic/custom' : 'gpt-4o',
        thinking: compatibleModel ? 'high' : 'off',
      },
      systemPrompt: 'Synthetic offline package smoke',
      permissionProfileId: 'deny-all',
    };
    await new Promise((resolve, reject) =>
      child.stdio[3].write(`${JSON.stringify(config)}\n`, (error) =>
        error ? reject(error) : resolve()
      )
    );
    const peer = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async (params) => {
          benchmark?.update(params);
        },
        unstable_createElicitation: async () => {
          throw new Error('offline_smoke_must_not_open_question');
        },
        extMethod: async () => {
          throw new Error('offline_smoke_must_not_dismiss_question');
        },
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    );
    let deadlineExpired = false;
    const timeout = setTimeout(() => {
      deadlineExpired = true;
      child.kill('SIGKILL');
    }, 30_000);
    try {
      const initialized = await peer.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: questionUI
          ? { elicitation: { form: {} }, _meta: { mollyQuestionUI: { version: 1 } } }
          : {},
      });
      assert.equal(initialized.agentInfo.name, 'molly');
      timings.initializeFromLaunchMs = performance.now() - launchedAt;
      const binding = {
        workspaceId: config.workspaceId,
        serverId: 'synthetic-protected',
        credentialRef: randomUUID(),
        revision: 1,
        destination: {
          transport: 'stdio',
          command: executable,
          args: [
            fileURLToPath(
              new URL(
                '../../../packages/harness-pi/tests/fixtures/protected-mcp.mjs',
                import.meta.url
              )
            ),
            'first',
          ],
        },
        fieldNames: ['TEST_MCP_TOKEN'],
      };
      const sessionStartedAt = performance.now();
      const session = await peer.newSession({
        cwd,
        mcpServers: protectedMcp
          ? [
              {
                name: 'synthetic-protected',
                command: binding.destination.command,
                args: binding.destination.args,
                env: [],
                _meta: {
                  mollyConnection: { id: binding.serverId, revision: 1 },
                  mollyMcpCredential: binding,
                },
              },
            ]
          : [],
      });
      timings.newSessionMs = performance.now() - sessionStartedAt;
      timings.sessionReadyFromLaunchMs = performance.now() - launchedAt;
      if (measure) memory.sessionReadyRssKiB = await workerRssKiB(child);
      assert.equal(session._meta.mollyRuntime.runtimeEpoch, config.runtimeEpoch);
      assert.deepEqual(session._meta.mollyRuntime.harness, config.harness);
      const basePluginHash = createHash('sha256').update('[]').digest('hex');
      if (questionUI) {
        const provenance = JSON.parse(
          await readFile(
            path.join(output, 'harness/extensions/pi-ask-question/manifest.json'),
            'utf8'
          )
        );
        const pluginSetHash = createHash('sha256')
          .update(
            JSON.stringify({
              base: basePluginHash,
              question: {
                name: provenance.name,
                version: provenance.version,
                commit: provenance.commit,
                sha256: provenance.adaptedSha256,
              },
            })
          )
          .digest('hex');
        assert.equal(session._meta.mollyRuntime.pluginSetHash, pluginSetHash);
        assert.notEqual(pluginSetHash, basePluginHash);
      } else {
        assert.equal(session._meta.mollyRuntime.pluginSetHash, basePluginHash);
      }
      assert.ok(
        session._meta.mollyRuntime.nativeSessionFile.startsWith(
          (await realpath(path.join(root, 'private', 'sessions'))) + path.sep
        )
      );
      assert.equal(await readFile(path.join(cwd, '.pi', 'settings.json'), 'utf8'), pollution);
      let lastPreparationMs;
      const prepareMcp = async (runId, turnId) => {
        if (!protectedMcp) return session._meta.mollyRuntime;
        const preparationStartedAt = performance.now();
        const preparation = {
          version: 1,
          runId,
          runtimeEpoch: config.runtimeEpoch,
          sessionId: config.productSessionId,
          turnId,
          workspaceId: config.workspaceId,
          connection: config.connection,
          mcpConnections: [binding],
        };
        await new Promise((resolve, reject) =>
          child.stdio[3].write(
            `${JSON.stringify({
              type: 'mcp-credentials',
              runId: preparation.runId,
              runtimeEpoch: preparation.runtimeEpoch,
              credentials: [{ connection: binding, values: { TEST_MCP_TOKEN: 'SYNTHETIC_FIRST' } }],
            })}\n`,
            (error) => (error ? reject(error) : resolve())
          )
        );
        const prepared = await peer.extMethod('_molly/prepare_mcp_run', {
          sessionId: session.sessionId,
          preparation,
        });
        lastPreparationMs = performance.now() - preparationStartedAt;
        assert.equal(prepared.nativeSessionFile, session._meta.mollyRuntime.nativeSessionFile);
        assert.notEqual(prepared.toolsetHash, session._meta.mollyRuntime.toolsetHash);
        assert.equal(prepared.runtimeEpoch, config.runtimeEpoch);
        assert.equal(prepared.pluginSetHash, session._meta.mollyRuntime.pluginSetHash);
        const history = await readFile(prepared.nativeSessionFile, 'utf8');
        assert.ok(!history.includes('SYNTHETIC_FIRST'));
        assert.ok(!JSON.stringify({ prepared, session }).includes('SYNTHETIC_FIRST'));
        return { ...prepared, mcpConnections: [binding] };
      };
      const initialBinding = await prepareMcp('synthetic-run', 'synthetic-turn');
      if (protectedMcp) {
        timings.protectedMcpPreparationMs = lastPreparationMs;
        if (measure) memory.mcpPreparedRssKiB = await workerRssKiB(child);
      }
      if (benchmark) {
        turns = await benchmark.exercise({
          peer,
          child,
          config,
          session,
          initialBinding,
          prepareMcp,
          readResources: async ({ index, kind }) => ({
            ...(await workerResources(child)),
            ...(diagnoseGc
              ? {
                  gcMemory: await observeCollectedMemory(
                    child,
                    index === 0 || index % 10 === 9 || kind !== 'completed'
                  ),
                }
              : {}),
          }),
        });
      }
      const shutdownStartedAt = performance.now();
      if (child.connected) child.disconnect();
      child.stdin.end();
      child.stdio[3].end();
      assert.equal(await exit, 0);
      timings.shutdownMs = performance.now() - shutdownStartedAt;
      assert.ok(!stderr.includes('SYNTHETIC_POLLUTION_CANARY'));
      assert.ok(!stderr.includes('SYNTHETIC_FIRST'));
      assert.ok(!stderr.includes('SYNTHETIC_BENCHMARK_KEY'));
      return {
        engineVersion: manifest.engineVersion,
        buildId: manifest.buildId,
        buildPlatform: manifest.buildPlatform,
        buildArch: manifest.buildArch,
        timings,
        memory,
        turns,
      };
    } catch (error) {
      if (deadlineExpired) throw new Error('synthetic_package_probe_deadline', { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
    await benchmark?.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flags = process.argv.slice(4);
  const output = path.resolve(process.argv[2] ?? 'apps/cli/dist');
  const executable = path.resolve(process.argv[3] ?? process.execPath);
  const measurement = flags.find((flag) => flag.startsWith('--measure='));
  const count = measurement ? Number(measurement.slice('--measure='.length)) : 1;
  assert.ok(
    Number.isInteger(count) && count >= 1 && count <= 100,
    '--measure requires 1–100 samples'
  );
  const options = {
    output,
    executable,
    protectedMcp: flags.includes('--protected-mcp'),
    questionUI: flags.includes('--question-ui'),
    compatibleModel: flags.includes('--compatible-model'),
    measure: Boolean(measurement),
    diagnoseGc: flags.includes('--diagnose-gc'),
    exerciseTurns: Number(
      flags
        .find((flag) => flag.startsWith('--exercise-turns='))
        ?.slice('--exercise-turns='.length) ?? 0
    ),
  };
  const samples = [];
  for (let index = 0; index < count; index++) {
    const sample = await runPackagedSmoke(options);
    if (measurement) console.error(`Measured packaged worker ${index + 1}/${count}`);
    samples.push(sample);
  }
  const first = samples[0];
  assert.ok(
    samples.every((sample) => sample.buildId === first.buildId),
    'Build changed during benchmark'
  );
  if (measurement) {
    const { stdout: runtimeOutput } = await execute(
      executable,
      [
        '-p',
        'JSON.stringify({node:process.versions.node,electron:process.versions.electron,platform:process.platform,arch:process.arch})',
      ],
      {
        env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' },
        timeout: 15_000,
        maxBuffer: 4096,
      }
    );
    const runtime = JSON.parse(runtimeOutput);
    assert.equal(runtime.platform, first.buildPlatform);
    assert.equal(runtime.arch, first.buildArch);
    const summarizeValues = (values) => {
      const sorted = values.toSorted((a, b) => a - b);
      assert.ok(sorted.length && sorted.every(Number.isFinite));
      return {
        count: sorted.length,
        min: sorted[0],
        p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        max: sorted.at(-1),
      };
    };
    const summarize = (section) =>
      Object.fromEntries(
        Object.keys(first[section]).map((key) => {
          return [key, summarizeValues(samples.map((sample) => sample[section][key]))];
        })
      );
    const allTurns = samples.flatMap((sample) => sample.turns);
    const turnDistributions = Object.fromEntries(
      ['first', 'warm', 'cancelled', 'after-cancel'].flatMap((phase) => {
        const selected = allTurns.filter((turn) => turn.phase === phase);
        return selected.length
          ? [
              [
                phase,
                Object.fromEntries(
                  [
                    'promptMs',
                    'prepareMs',
                    'cancelToSettledMs',
                    'cancelToSocketCloseMs',
                    'rssKiB',
                    'fileDescriptorCount',
                  ].flatMap((key) => {
                    const values = selected
                      .map((turn) => turn[key])
                      .filter((value) => value !== undefined);
                    return values.length ? [[key, summarizeValues(values)]] : [];
                  })
                ),
              ],
            ]
          : [];
      })
    );
    console.log(
      JSON.stringify(
        {
          kind: 'packaged-worker-baseline',
          measuredAt: new Date().toISOString(),
          environment: {
            platform: platform(),
            arch: arch(),
            osRelease: release(),
            cpu: cpus()[0]?.model,
            cpuCount: cpus().length,
            driverNode: process.versions.node,
            runtime,
            executable,
          },
          options,
          buildId: first.buildId,
          engineVersion: first.engineVersion,
          limits: [
            'Fresh worker and private state per sample; OS caches are not cleared.',
            'Manifest verification and fixture setup are excluded from startup.',
            options.exerciseTurns
              ? 'Synthetic loopback turns and active HTTP cancellation only; no live provider, application UI or installer acceptance.'
              : 'No model inference, active cancellation, application UI, installer or same-worker memory-growth acceptance.',
            'RSS observations are point samples, not peak measurements; no performance threshold is asserted.',
            ...(options.diagnoseGc
              ? [
                  'Forced full GC changes allocation/latency behavior. Diagnostic samples are not normal-run performance acceptance.',
                ]
              : []),
          ],
          distributions: {
            timings: summarize('timings'),
            memory: summarize('memory'),
            turns: turnDistributions,
          },
          samples,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `PASS offline packaged ACP ${options.protectedMcp ? 'protected MCP preparation' : 'startup'}${options.questionUI ? ' with question UI negotiation' : ''}${options.compatibleModel ? ' and explicit compatible model' : ''}: Pi ${first.engineVersion}, ${first.buildPlatform}/${first.buildArch}, build ${first.buildId}`
    );
  }
}
