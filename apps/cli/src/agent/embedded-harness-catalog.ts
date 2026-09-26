import { dirname, resolve } from 'node:path';
import type {
  AcpCapabilityCacheEntry,
  AcpConfigOptionSummary,
  MachineId,
  WorkspaceId,
} from '@molly/shared';
import {
  encodeMollyModelOption,
  MOLLY_DEFAULT_PERMISSION_MODE,
  MOLLY_UNSELECTED_MODEL,
  type HarnessModelCatalog,
  type ModelConnection,
} from '@molly/shared/embedded-harness';
import type { LoroDocumentManager } from '../lib/loro/doc';
import { readMachineAgentConfigs } from '../lib/agent-config-machine-flock';
import { readEmbeddedHarnessCatalog } from './embedded-harness-runtime';

/** Project into the existing composer catalog instead of storing another selection table. */
export function projectEmbeddedHarnessCatalog(
  catalog: HarnessModelCatalog,
  connections: readonly ModelConnection[]
) {
  const models: AcpCapabilityCacheEntry['models'] = [
    { modelId: MOLLY_UNSELECTED_MODEL, name: 'Select a connection and model' },
  ];
  const modelReasoningEfforts: Record<string, string[]> = { [MOLLY_UNSELECTED_MODEL]: ['off'] };
  for (const connection of connections) {
    if (!connection.enabled) continue;
    const connectionModels =
      connection.providerPresetId === 'openai-compatible'
        ? (connection.customModels ?? []).map((model) => ({
            ...model,
            providerPresetId: connection.providerPresetId,
          }))
        : catalog.models;
    for (const model of connectionModels) {
      if (model.providerPresetId !== connection.providerPresetId) continue;
      const modelId = encodeMollyModelOption(connection.id, model.modelId);
      models.push({
        modelId,
        name: `${connection.displayName} · ${model.name}`,
        description: model.modelId,
      });
      modelReasoningEfforts[modelId] = [...model.thinking];
    }
  }
  const modes: Array<{ id: string; name: string; description: string }> = [
    { id: 'ask', name: 'Ask', description: 'Ask before protected actions' },
    {
      id: 'auto-review',
      name: 'Auto-review',
      description:
        'Run shell commands in an OS sandbox without asking; a model reviews actions that leave it and asks you when it declines',
    },
  ];
  const configOptions: AcpConfigOptionSummary[] = [
    {
      id: 'mode',
      name: 'Permission',
      category: 'mode',
      type: 'select',
      currentValue: MOLLY_DEFAULT_PERMISSION_MODE,
      options: modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description,
      })),
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: MOLLY_UNSELECTED_MODEL,
      options: models.map((model) => ({
        value: model.modelId,
        name: model.name ?? model.modelId,
        description: model.description ?? undefined,
      })),
    },
    {
      id: 'reasoning_effort',
      name: 'Thinking',
      category: 'thought_level',
      type: 'select',
      currentValue: 'off',
      options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
        value,
        name: value,
      })),
    },
  ];
  return { modes, models, configOptions, modelReasoningEfforts };
}

/** Only a protected desktop host may expose this engine. No model request or secret lookup. */
export class EmbeddedHarnessCatalogPublisher {
  private pending: Promise<void> = Promise.resolve();
  private published?: string;
  private resource?: Awaited<ReturnType<typeof readEmbeddedHarnessCatalog>>;
  constructor(
    private readonly documents: LoroDocumentManager,
    private readonly machineId: MachineId,
    private readonly workspaceId: WorkspaceId,
    private readonly load = () => readEmbeddedHarnessCatalog(dirname(resolve(process.argv[1]!)))
  ) {}

  publish(connections: readonly ModelConnection[]): Promise<void> {
    const frozen = structuredClone(connections);
    const next = this.pending.then(async () => {
      this.resource ??= await this.load();
      const fingerprint = JSON.stringify([this.resource.sourceVersion, frozen]);
      if (fingerprint === this.published) return;
      // This publisher is driven by the protected, machine-local desktop host.
      // Local Flock is authoritative here; syncMachineFlockDoc confirms CLOUD
      // transport delivery and correctly returns false in the local composition.
      // createAgentConfig/updateAcpCapabilities flush locally and schedule sync.
      const configs = await readMachineAgentConfigs(
        this.documents.repo,
        this.workspaceId,
        this.machineId
      );
      const existing = Object.values(configs).filter(
        (config) => config.cliType === 'builtin' && config.agentType === 'molly'
      );
      if (existing.length > 1) throw new Error('harness_duplicate_agent_identity');
      const configId =
        existing[0]?.id ??
        (await this.documents.createAgentConfig('builtin', 'molly', this.machineId, 'Molly'));
      const projected = projectEmbeddedHarnessCatalog(this.resource.catalog, frozen);
      await this.documents.updateAcpCapabilities(
        this.machineId,
        configId,
        'builtin',
        'molly',
        projected.modes,
        projected.models.map((model) => ({
          ...model,
          description: model.description ?? undefined,
        })),
        projected.configOptions,
        [],
        false,
        this.resource.sourceVersion,
        projected.modelReasoningEfforts
      );
      this.published = fingerprint;
    });
    this.pending = next.catch(() => undefined);
    return next;
  }
}
