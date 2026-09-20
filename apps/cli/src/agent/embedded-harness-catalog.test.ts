import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { HarnessModelCatalog, ModelConnection } from '@molly/shared/embedded-harness';
import { decodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';
import { projectEmbeddedHarnessCatalog } from './embedded-harness-catalog';
import { EmbeddedHarnessCatalogPublisher } from './embedded-harness-catalog';
import { readEmbeddedHarnessCatalog } from './embedded-harness-runtime';
import {
  machineFlockKeys,
  type AgentConfigId,
  type AgentConfigMeta,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';
import type { LoroDocumentManager } from '../lib/loro/doc';

const catalog: HarnessModelCatalog = {
  version: 1,
  engineVersion: '0.85.1',
  models: [
    {
      providerPresetId: 'kimi-coding',
      modelId: 'k3-256k',
      name: 'K3',
      input: ['text', 'image'],
      contextWindow: 262144,
      thinking: ['off', 'high'],
    },
  ],
};
const connection: ModelConnection = {
  schemaVersion: 1,
  id: 'first',
  revision: 1,
  providerPresetId: 'kimi-coding',
  displayName: 'First',
  baseUrl: 'https://provider.example/coding',
  credentialRef: 'private-reference',
  enabled: true,
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("projects only each compatible connection's declared models without borrowing native catalog entries", () => {
  const advanced: ModelConnection = {
    ...connection,
    providerPresetId: 'openai-compatible',
    customModels: [
      {
        modelId: 'vendor/custom',
        name: 'Custom',
        input: ['text'],
        contextWindow: 32768,
        maxTokens: 4096,
        thinking: ['high'],
        toolCalls: true,
        usageInStreaming: true,
        maxTokensField: 'max_tokens',
      },
    ],
  };
  const result = projectEmbeddedHarnessCatalog(catalog, [
    advanced,
    {
      ...advanced,
      id: 'other',
      customModels: advanced.customModels?.map((model) => ({ ...model, thinking: ['off'] })),
    },
    { ...advanced, id: 'legacy', customModels: undefined },
  ]);
  expect(result.models.map((model) => model.name)).toEqual([
    'Select a connection and model',
    'First · Custom',
    'First · Custom',
  ]);
  expect(
    result.models.slice(1).map((model) => result.modelReasoningEfforts[model.modelId])
  ).toEqual([['high'], ['off']]);
  expect(
    result.models.slice(1).map((model) => decodeMollyModelOption(model.modelId)?.connectionId)
  ).toEqual(['first', 'other']);
  expect(JSON.stringify(result)).not.toContain('private-reference');
});

it('keeps duplicate model IDs separated by connection and leaves first use unselected', () => {
  const result = projectEmbeddedHarnessCatalog(catalog, [
    connection,
    { ...connection, id: 'second', displayName: 'Second' },
    { ...connection, id: 'disabled', enabled: false },
  ]);
  expect(result.models[0]?.modelId).toBe(MOLLY_UNSELECTED_MODEL);
  expect(
    result.models
      .slice(1)
      .map((model) => decodeMollyModelOption(model.modelId, 'high')?.connectionId)
  ).toEqual(['first', 'second']);
  expect(result.modelReasoningEfforts[result.models[1]!.modelId]).toEqual(['off', 'high']);
  const modelSelector = result.configOptions.find((option) => option.category === 'model');
  expect(modelSelector?.currentValue).toBe(MOLLY_UNSELECTED_MODEL);
  expect(modelSelector?.options.map((option) => option.value)).toEqual(
    result.models.map((model) => model.modelId)
  );
  expect(JSON.stringify(result)).not.toContain('private-reference');
  expect(projectEmbeddedHarnessCatalog(catalog, []).models).toEqual([result.models[0]]);
});

it('reads only a platform-matched, hash-verified catalog from the packaged directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molly-catalog-'));
  roots.push(root);
  await mkdir(join(root, 'harness'));
  const bytes = JSON.stringify(catalog);
  const manifest = {
    engineVersion: '0.85.1',
    protocolVersion: 1,
    buildId: 'synthetic-build',
    buildPlatform: process.platform,
    buildArch: process.arch,
    files: [
      { path: 'model-catalog.json', sha256: createHash('sha256').update(bytes).digest('hex') },
    ],
  };
  await writeFile(join(root, 'harness/runtime-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'harness/model-catalog.json'), bytes);
  await expect(readEmbeddedHarnessCatalog(root)).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(root, 'molly-pi-agent.js'), '// synthetic packaged entry');
  expect((await readEmbeddedHarnessCatalog(root)).catalog).toEqual(catalog);
  await writeFile(join(root, 'harness/model-catalog.json'), '{}');
  await expect(readEmbeddedHarnessCatalog(root)).rejects.toThrow(
    'harness_model_catalog_checksum_mismatch'
  );
  await writeFile(
    join(root, 'harness/runtime-manifest.json'),
    JSON.stringify({ ...manifest, buildArch: 'wrong' })
  );
  await expect(readEmbeddedHarnessCatalog(root)).rejects.toThrow('harness_platform_mismatch');
});

it('publishes from the local machine authority without cloud confirmation and reuses its durable identity', async () => {
  const machineId = 'machine-test' as MachineId;
  const workspaceId = 'workspace-test' as WorkspaceId;
  const id = '00000000-0000-4000-8000-000000000001' as AgentConfigId;
  const configs: AgentConfigMeta[] = [];
  const publications: unknown[] = [];
  let failPublication = true;
  const documents = {
    repo: {
      openFlockDoc: async () => ({
        flock: {
          scan: () =>
            configs.map((value) => ({ key: machineFlockKeys.agentConfig(value.id), value })),
        },
      }),
    },
    syncMachineFlockDoc: async () => false,
    createAgentConfig: async () => {
      configs.push({
        id,
        machineId,
        cliType: 'builtin',
        agentType: 'molly',
        name: 'Molly',
        env: {},
      });
      return id;
    },
    updateAcpCapabilities: async (...args: unknown[]) => {
      if (failPublication) throw new Error('synthetic_flush_failure');
      publications.push(args);
    },
  } as unknown as LoroDocumentManager;
  const publisher = new EmbeddedHarnessCatalogPublisher(
    documents,
    machineId,
    workspaceId,
    async () => ({ catalog, sourceVersion: 'molly-pi:0.85.1:synthetic' })
  );
  await expect(publisher.publish([connection])).rejects.toThrow('synthetic_flush_failure');
  expect(configs.map((config) => config.id)).toEqual([id]);
  failPublication = false;
  await Promise.all([publisher.publish([connection]), publisher.publish([connection])]);
  expect(configs.map((config) => config.id)).toEqual([id]);
  expect(publications).toEqual([
    [
      machineId,
      id,
      'builtin',
      'molly',
      [],
      projectEmbeddedHarnessCatalog(catalog, [connection]).models.map((model) => ({
        ...model,
        description: model.description ?? undefined,
      })),
      projectEmbeddedHarnessCatalog(catalog, [connection]).configOptions,
      [],
      false,
      'molly-pi:0.85.1:synthetic',
      projectEmbeddedHarnessCatalog(catalog, [connection]).modelReasoningEfforts,
    ],
  ]);
});
