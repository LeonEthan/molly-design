import { describe, expect, it } from 'vitest';
import {
  ACP_CAPABILITY_CACHE_VERSION,
  REGISTRY_ACP_AGENTS,
  type AcpCapabilityCacheEntry,
  type AgentConfigMeta,
} from '@molly/shared';
import {
  SessionExecutionService,
  type SessionExecutionServiceDeps,
} from './session-execution-service';

const request = {
  type: 'machine/acp-capabilities-refresh' as const,
  machineId: 'machine-1',
  workspaceId: 'workspace-1',
  configId: 'config-1',
};
const config: AgentConfigMeta = {
  id: request.configId,
  machineId: request.machineId,
  name: 'Molly',
  cliType: 'builtin',
  agentType: 'molly',
  env: {},
};
const catalog: AcpCapabilityCacheEntry = {
  cliType: 'builtin',
  agentType: 'molly',
  cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
  sourceVersion: 'molly-pi:0.85.1:synthetic',
  provenance: 'runtime',
  fetchedAt: 1,
  modes: [],
  models: [{ modelId: 'explicit-model', name: 'Explicit model' }],
  configOptions: [],
  availableCommands: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(
  options: {
    getConfig?: () => Promise<AgentConfigMeta | null>;
    read?: (id: string) => Promise<AcpCapabilityCacheEntry | undefined>;
  } = {}
) {
  const effects: string[] = [];
  const fail = async () => {
    effects.push('forbidden-write-or-probe');
    throw new Error('forbidden');
  };
  const deps = {
    machineId: request.machineId,
    logger: { debug() {} },
    workspaceDocument: {
      getAgentConfigForMachineLaunch: options.getConfig ?? (async () => config),
      getAcpCapabilities: async (_machine: string, id: string) =>
        options.read ? options.read(id) : catalog,
      updateAcpCapabilities: fail,
    },
    fetchAcpCapabilities: fail,
  } as unknown as SessionExecutionServiceDeps;
  return { service: new SessionExecutionService(deps), effects };
}

describe('embedded-only catalog refresh', () => {
  const targets = [
    ...['kimi', 'codex', 'claude', 'grok', 'deepseek', 'pi'].map((agentType) => ({
      cliType: 'builtin' as const,
      agentType,
    })),
    ...REGISTRY_ACP_AGENTS.map((agent) => ({ cliType: 'registry' as const, agentType: agent.id })),
    { cliType: 'custom' as const, agentType: 'custom' },
    { cliType: 'registry' as const, agentType: 'molly' },
  ];
  it.each(targets)(
    'refuses $cliType/$agentType without reading or rewriting capabilities',
    async (target) => {
      const h = harness({
        getConfig: async () => ({ ...config, ...target }),
        read: async () => {
          throw new Error('legacy catalog must not be read');
        },
      });
      expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
        success: false,
        error: 'legacy_harness_execution_disabled',
        ...target,
      });
      expect(h.effects).toEqual([]);
    }
  );
  it.each([{ runtimeOverrides: {} }, { customAcp: { command: 'injected', args: [] } }])(
    'refuses Molly launch overrides: %j',
    async (override) => {
      const h = harness({ getConfig: async () => ({ ...config, ...override }) });
      expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
        success: false,
        error: 'harness_launch_override_forbidden',
      });
      expect(h.effects).toEqual([]);
    }
  );
  it('returns the published catalog without probing or persisting', async () => {
    const h = harness();
    expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
      success: true,
      cliType: 'builtin',
      agentType: 'molly',
      capability: catalog,
      models: catalog.models,
    });
    expect(h.effects).toEqual([]);
  });
  it.each([
    undefined,
    { ...catalog, sourceVersion: 'registry:old' },
    { ...catalog, agentType: 'codex' },
    { ...catalog, cliType: 'registry' as const },
    { ...catalog, cacheVersion: ACP_CAPABILITY_CACHE_VERSION - 1 },
  ])('refuses missing or non-embedded cache without fallback', async (value) => {
    const h = harness({ read: async () => value });
    expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
      success: false,
      error: 'harness_catalog_unavailable',
    });
    expect(h.effects).toEqual([]);
  });
  it('shares an in-flight read without letting one caller cancel another', async () => {
    const started = deferred<void>(),
      done = deferred<AcpCapabilityCacheEntry>();
    const h = harness({
      read: async () => {
        started.resolve();
        return done.promise;
      },
    });
    const controller = new AbortController();
    const first = h.service.refreshMachineAcpCapabilities(request, { signal: controller.signal });
    const second = h.service.refreshMachineAcpCapabilities(request);
    await started.promise;
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    done.resolve(catalog);
    await expect(second).resolves.toMatchObject({ success: true, capability: catalog });
    expect(h.effects).toEqual([]);
  });
  it('does not let a cancelled read overwrite a new result', async () => {
    const started = deferred<void>(),
      old = deferred<AcpCapabilityCacheEntry>();
    let pending = true;
    const h = harness({
      read: async () => {
        if (pending) {
          pending = false;
          started.resolve();
          return old.promise;
        }
        return catalog;
      },
    });
    const controller = new AbortController();
    const first = h.service.refreshMachineAcpCapabilities(request, { signal: controller.signal });
    await started.promise;
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
      success: true,
      capability: catalog,
    });
    old.resolve({ ...catalog, sourceVersion: 'molly-pi:old-build' });
    expect(h.effects).toEqual([]);
  });
  it('keeps configs separate and clears failed reads for explicit retry', async () => {
    let broken = true;
    const h = harness({
      read: async (id) => {
        if (broken) throw new Error('catalog read failed');
        return { ...catalog, models: [{ modelId: id }] };
      },
    });
    expect(await h.service.refreshMachineAcpCapabilities(request)).toMatchObject({
      success: false,
    });
    broken = false;
    const results = await Promise.all(
      [request, { ...request, configId: 'config-2' }].map((r) =>
        h.service.refreshMachineAcpCapabilities(r)
      )
    );
    expect(results.map((r) => r.models)).toEqual([
      [{ modelId: 'config-1' }],
      [{ modelId: 'config-2' }],
    ]);
    expect(h.effects).toEqual([]);
  });
  it('rejects an aborted request without reading the catalog', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness({
      read: async () => {
        throw new Error('must not read');
      },
    });
    await expect(
      h.service.refreshMachineAcpCapabilities(request, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
