import { describe, expect, it, vi } from 'vitest';
import type { MachineId, WorkspaceId } from '@molly/shared';
import { createLocalCloudPort } from '@molly/platform';
import type { LoroDocumentManager } from '../lib/loro/doc';
import type { Logger } from '../utils/logger';
import type { SessionConfig } from './types';
import { SessionManager, type ISession, type CreateAgentConfig } from './session-manager';
import { HarnessCredentialBroker } from '../agent/harness-credential-broker';

vi.mock('@/agent/setting', async (original) => ({
  ...(await original<typeof import('@/agent/setting')>()),
  resolveACPProcessLaunchAsync: async () => ({ command: 'synthetic', args: [] }),
}));

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  setLevel() {},
  setDebug() {},
  child() {
    return this;
  },
  async close() {},
};
const config = {
  sessionId: 'codex-design',
  machineId: 'machine',
  workspaceId: 'workspace',
  agentCliType: 'builtin',
  agentType: 'codex',
  mcpServerIds: [],
} as unknown as SessionConfig;

function manager(design: boolean, parentSessionId?: string) {
  return new SessionManager(
    logger,
    'local-test',
    'machine' as MachineId,
    'workspace' as WorkspaceId,
    {
      getOrCreateSessionDoc: async () => ({
        getMetaState: async () => ({
          ...(design
            ? { design: { artworkId: parentSessionId ?? 'codex-design', path: 'design.json' } }
            : {}),
          ...(parentSessionId ? { parentSessionId } : {}),
        }),
      }),
    } as unknown as LoroDocumentManager,
    { cloudPort: createLocalCloudPort({ identity: { userId: 'local:test' }, workspaces: [] }) }
  );
}

describe('Codex design reminder activation', () => {
  it('enables design runtime tools from accepted shared-artwork tab metadata', async () => {
    const owner = manager(true, 'design-parent');
    const credentials = new HarnessCredentialBroker();
    credentials.exchange({
      version: 1,
      connections: [
        {
          schemaVersion: 1,
          id: 'synthetic-connection',
          revision: 1,
          providerPresetId: 'openai',
          displayName: 'Synthetic',
          baseUrl: 'https://example.invalid/v1',
          credentialRef: 'synthetic-unused',
          enabled: true,
        },
      ],
      reports: [],
    });
    owner.setHarnessCredentials(credentials);
    let received: CreateAgentConfig | undefined;
    const signal = Error('synthetic spawn boundary');
    const session = {
      getWorkdir: () => '/synthetic',
      updateGitIdentity() {},
      async terminate() {},
      async createAgent(value: CreateAgentConfig) {
        received = value;
        throw signal;
      },
    } as unknown as ISession;
    const internal = owner as unknown as {
      createSessionInner(value: SessionConfig): Promise<ISession>;
      createSessionInnerWithAgent(value: SessionConfig): Promise<ISession>;
    };
    vi.spyOn(internal, 'createSessionInner').mockResolvedValue(session);

    await expect(
      internal.createSessionInnerWithAgent({
        ...config,
        agentType: 'molly',
        modelSelection: {
          connectionId: 'synthetic-connection',
          modelId: 'synthetic-model',
        },
      })
    ).rejects.toBe(signal);

    expect(received?.designHooks).toBe(true);
  });

  it.each(['codex', 'kimi', 'grok', 'claude'])(
    'takes %s registration from durable design identity',
    async (agentType) => {
      for (const design of [true, false]) {
        const owner = manager(design);
        let received: CreateAgentConfig | undefined;
        const signal = Error('synthetic spawn boundary');
        const session = {
          getWorkdir: () => '/synthetic',
          updateGitIdentity() {},
          async terminate() {},
          async createAgent(value: CreateAgentConfig) {
            received = value;
            throw signal;
          },
        } as unknown as ISession;
        const internal = owner as unknown as {
          createSessionInner(value: SessionConfig): Promise<ISession>;
          createSessionInnerWithAgent(value: SessionConfig): Promise<ISession>;
        };
        vi.spyOn(internal, 'createSessionInner').mockResolvedValue(session);
        await expect(
          internal.createSessionInnerWithAgent({ ...config, agentType } as SessionConfig)
        ).rejects.toBe(signal);
        expect(received?.agentType).toBe(agentType);
        expect(received?.designHooks).toBe(design);
      }
    }
  );

  it.each(['codex', 'kimi', 'grok', 'claude', 'pi-acp'])(
    'disposes speculation before cold-starting a newly identified %s design session',
    async (agentType) => {
      const owner = manager(true);
      const events: string[] = [];
      const replacement = { sessionId: config.sessionId } as ISession;
      const internal = owner as unknown as {
        createSessionInnerWithAgent(value: SessionConfig): Promise<ISession>;
        finishPreparedSession(
          value: SessionConfig,
          prepared: { dispose(): Promise<void>; adopt(): Promise<void> }
        ): Promise<ISession>;
      };
      vi.spyOn(internal, 'createSessionInnerWithAgent').mockImplementation(async () => {
        events.push('cold-start');
        return replacement;
      });
      const result = await internal.finishPreparedSession(
        { ...config, agentType } as SessionConfig,
        {
          async dispose() {
            events.push('dispose');
          },
          async adopt() {
            throw Error('an unhooked speculative runtime must not be adopted');
          },
        }
      );
      expect(result).toBe(replacement);
      expect(events).toEqual(['dispose', 'cold-start']);
    }
  );
});
