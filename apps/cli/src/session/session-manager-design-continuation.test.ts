import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildDesignContinuationMeta,
  buildDesignContinuationReference,
  DesignContinuationRecordSchema,
  getDesignContinuationSystemContext,
  type SessionMeta,
} from '@molly/shared';
import { createLocalCloudPort } from '@molly/platform';
import { SessionManager, type CreateAgentConfig, type ISession } from './session-manager';
import { getDefaultSessionWorkdir, type Session } from './session';
import { createNoopSessionSandbox } from './session-sandbox';
import { resolveDesignWorkspace } from '../design/workspace';
import { designOperation } from '../design/store';
import { materializeDesignTurnInput } from '../design/turn-input';
import type { SessionConfig } from './types';
import type { Logger } from '@/utils/logger';

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
const receipt = DesignContinuationRecordSchema.parse({
  version: 1,
  workspaceId: 'workspace-1',
  source: {
    id: 'source',
    machineId: 'machine-1',
    userId: 'local:user',
    cliType: 'builtin',
    agentType: 'codex',
    design: { artworkId: '00000000-0000-4000-8000-000000000002', path: 'design.json' },
  },
  target: {
    sessionId: '00000000-0000-4000-8000-000000000001',
    agentConfigId: 'molly-config',
    createdAt: '2026-09-20T00:00:00.000Z',
  },
  reference: buildDesignContinuationReference({
    source: {
      sessionId: 'source',
      artworkId: '00000000-0000-4000-8000-000000000002',
      machineId: 'machine-1',
    },
    history: [],
  }),
});

function fixture() {
  const state: { meta: SessionMeta; deleted: boolean; receipt: typeof receipt | undefined } = {
    meta: buildDesignContinuationMeta(receipt),
    deleted: false,
    receipt,
  };
  const inspectedDocs: string[] = [];
  const owner = new SessionManager(
    logger,
    'synthetic-token',
    'machine-1' as never,
    'workspace-1' as never,
    {
      repo: { getDocMeta: async () => ({ meta: state.meta, deleted: state.deleted }) },
      getOrCreateSessionDoc: async (id: string) => {
        if (id !== state.meta.id) throw new Error('source document must not be reopened');
        inspectedDocs.push(id);
        return { getDesignContinuation: () => state.receipt };
      },
    } as never,
    {
      cloudPort: createLocalCloudPort({ identity: { userId: 'local:user' }, workspaces: [] }),
      sessionSandboxFactory: async () => createNoopSessionSandbox(),
    }
  );
  owner.setHarnessCredentials({
    catalog: () => [{ id: 'synthetic-connection', enabled: true }],
  } as never);
  const internal = owner as unknown as {
    buildCreateAgentConfig(
      session: unknown,
      config: SessionConfig,
      launch: unknown
    ): CreateAgentConfig;
  };
  const launch = internal.buildCreateAgentConfig(
    {},
    {
      sessionId: state.meta.id,
      agentCliType: 'builtin',
      agentType: 'molly',
      modelSelection: {
        connectionId: 'synthetic-connection',
        modelId: 'k3-256k',
        thinking: 'high',
      },
    } as SessionConfig,
    { command: 'synthetic', args: [] }
  );
  const config: SessionConfig = {
    sessionId: state.meta.id,
    workspaceId: 'workspace-1' as never,
    machineId: 'machine-1',
    requesterUserId: 'local:user',
    agentConfigId: state.meta.agentConfigId,
    agentCliType: 'builtin',
    agentType: 'molly',
    assumeDocExisting: true,
    mcpServerIds: [],
    taskToolsEnabled: false,
    userName: 'Synthetic',
    userEmail: 'synthetic@example.test',
  };
  return {
    state,
    owner,
    config,
    inspectedDocs,
    read: launch.embeddedHarness!.readDesignContinuationContext!,
  };
}

describe('Molly startup design continuation binding', () => {
  it('loads only the target receipt into the existing private bootstrap context', async () => {
    const f = fixture();
    expect(await f.read()).toBe(getDesignContinuationSystemContext(f.state.meta, receipt));
    expect(f.inspectedDocs).toEqual([receipt.target.sessionId]);
  });

  it('does not open history for an ordinary Molly Session', async () => {
    const f = fixture();
    delete f.state.meta.designContinuation;
    expect(await f.read()).toBeUndefined();
    expect(f.inspectedDocs).toEqual([]);
  });

  it('rejects deleted targets before opening the document', async () => {
    const f = fixture();
    f.state.deleted = true;
    await expect(f.read()).rejects.toThrow('design_continuation_target_deleted');
    expect(f.inspectedDocs).toEqual([]);
  });

  it.each(['missing', 'foreign-workspace', 'foreign-artwork'] as const)(
    'rejects %s context',
    async (kind) => {
      const f = fixture();
      if (kind === 'missing') f.state.receipt = undefined;
      if (kind === 'foreign-workspace')
        f.state.receipt = { ...receipt, workspaceId: 'other-workspace' };
      if (kind === 'foreign-artwork')
        f.state.meta.design = { artworkId: 'other-artwork', path: 'design.json' };
      await expect(f.read()).rejects.toThrow('design_continuation_binding_mismatch');
    }
  );

  it.each<Partial<SessionConfig>>([
    { parentSessionId: 'source' as never },
    { project: { kind: 'github', repoFullName: 'synthetic/old' } },
    { repoId: 'old-repo' as never },
    { githubRepo: 'synthetic/old' },
    { githubRepoUrl: 'https://example.test/old.git' },
    { branch: 'old-main' },
    { restoreBranchName: 'old-worktree' },
    { worktreeStartPoint: 'a'.repeat(40) },
    { workdir: '/synthetic/old-project' },
    { requesterUserId: 'other-user' },
    { agentConfigId: 'legacy-config' as never },
    { agentType: 'codex' },
  ])('rejects inherited or foreign launch inputs before preparing a runtime: %j', async (patch) => {
    const f = fixture();
    await expect(f.owner.createSession({ ...f.config, ...patch })).rejects.toThrow(
      'design_continuation_launch_mismatch'
    );
    expect(f.owner.hasSession(f.state.meta.id)).toBe(false);
    expect(f.inspectedDocs).toEqual([f.state.meta.id]);
  });

  it('refuses legacy child metadata and native forks before runtime creation', async () => {
    const f = fixture();
    f.state.meta.parentSessionId = receipt.source.id as never;
    await expect(f.owner.createSession(f.config)).rejects.toThrow(
      'design_continuation_binding_mismatch'
    );
    delete f.state.meta.parentSessionId;
    await expect(
      f.owner.createSession(f.config, { forkSessionId: 'old-native' as never })
    ).rejects.toThrow('design_continuation_launch_mismatch');
    expect(f.owner.hasSession(f.state.meta.id)).toBe(false);
  });

  it.each([undefined, 'archived-root'])(
    'uses an independent workspace and the existing artwork for source parent %s',
    async (parent) => {
      const root = await mkdtemp(path.join(tmpdir(), 'molly-continuation-workspace-'));
      vi.stubEnv('MOLLY_DATA_DIR', root);
      let session: ISession | undefined;
      try {
        const f = fixture();
        const source = {
          ...receipt.source,
          parentSessionId: parent,
          project: { kind: 'github' as const, repoFullName: 'synthetic/old', branch: 'main' },
          repoFullName: 'synthetic/old',
          baseBranch: 'main',
          branchName: 'archived-worktree',
        };
        f.state.receipt = { ...receipt, source };
        f.state.meta = buildDesignContinuationMeta(f.state.receipt);
        const oldDraft = path.join(root, 'preserved-old-draft', 'design.yaml');
        await mkdir(path.dirname(oldDraft), { recursive: true });
        await writeFile(oldDraft, 'unfinished source draft');
        const payload = await designOperation(root, {
          operation: 'create',
          association: {
            sessionId: source.design.artworkId,
            name: 'Synthetic existing artwork',
            userId: source.userId,
            machineId: source.machineId,
            createdAt: receipt.target.createdAt,
          },
          width: 320,
          height: 200,
        });
        // Replace only the paid Agent stage; public acceptance and the real
        // workspace constructor run. Source/root document access still throws.
        const lifecycle = f.owner as unknown as {
          createSessionInner(config: SessionConfig): Promise<Session>;
          createSessionInnerWithAgent(config: SessionConfig): Promise<ISession>;
        };
        vi.spyOn(lifecycle, 'createSessionInnerWithAgent').mockImplementation((config) =>
          lifecycle.createSessionInner(config)
        );
        session = await f.owner.createSession({
          ...f.config,
          parentSessionId: f.state.meta.parentSessionId,
          project: f.state.meta.project,
        });
        const cwd = session.getWorkdir();
        expect(cwd).toBe(getDefaultSessionWorkdir(f.state.meta.id));
        const workspace = resolveDesignWorkspace({
          workspaceRoot: cwd,
          sessionId: f.state.meta.id,
          artworkId: source.design.artworkId,
          legacyWorkdir: cwd,
        });
        expect(workspace.artifactWorkdir).toBe(cwd);
        expect(workspace.projectionWorkdir).toBe(
          path.join(root, 'chats', source.design.artworkId, 'design-current')
        );
        const manifest = await materializeDesignTurnInput({
          workdir: cwd,
          artifactWorkdir: workspace.artifactWorkdir,
          artworkId: source.design.artworkId,
          turnId: 'first-new-turn',
          prompt: 'Continue the existing design',
          skillSourceIdentity: 'a'.repeat(64),
          dataRoot: root,
        });
        expect(manifest.baselineRevisionId).toBe(payload.revisionId);
        expect(manifest.artifactAtSend).toEqual({ status: 'absent' });
        expect(await readFile(oldDraft, 'utf8')).toBe('unfinished source draft');
        await expect(access(path.join(root, 'repos'))).rejects.toThrow();
        await expect(access(getDefaultSessionWorkdir(source.id as never))).rejects.toThrow();
        expect(new Set(f.inspectedDocs)).toEqual(new Set([f.state.meta.id]));
        expect(f.state.receipt.source).toEqual(source);
      } finally {
        await session?.terminate(true);
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
