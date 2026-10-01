import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk';
import { DefaultResourceLoader, SettingsManager, initTheme } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import {
  createProfileSettings,
  externalCliSubagents,
  resolvePiPackageRoot,
  writeProfileSettings,
} from '../src/profile-settings';
import { pathToFileURL } from 'node:url';
import type { AdapterPeer } from '../src/session';
import { fauxAssistantMessage, fauxToolCall, fixture } from './fixtures/adapter';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function useProfile(agentDir: string) {
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({
      ...createProfileSettings(),
      retry: { enabled: false },
      compaction: { enabled: false },
    })
  );
}

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });

describe('application Pi profile packages', () => {
  it('loads every bundled add-on through native discovery without load errors', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-profile-')));
    roots.push(root);
    const agentDir = join(root, 'config');
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    await writeProfileSettings(agentDir);
    const settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'));
    expect(settings).toMatchObject({ defaultProjectTrust: 'always', enableAnalytics: false });
    expect(settings.subagents.defaultExtensions).toEqual([
      expect.stringMatching(/cc-safety-net[/\\]dist[/\\]pi[/\\]index\.js$/),
    ]);
    initTheme('dark', false);
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager: SettingsManager.create(root, agentDir),
    });
    await loader.reload();
    const { errors, extensions } = loader.getExtensions();
    expect(errors).toEqual([]);
    const tools = extensions.flatMap((extension) => [...extension.tools.keys()]);
    expect(tools).toEqual(
      expect.arrayContaining(['subagent', 'ask_user_question', 'ffgrep', 'fffind'])
    );
    const commands = extensions.flatMap((extension) => [...extension.commands.keys()]);
    expect(commands).toEqual(expect.arrayContaining(['skillful', 'cc-safety-net']));
  });

  it('offers only native Pi sub-agents, never another installed CLI and account', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-profile-')));
    roots.push(root);
    vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'config'));
    await writeProfileSettings(join(root, 'config'));
    const discovery = await import(
      pathToFileURL(join(resolvePiPackageRoot('pi-subagents'), 'src/agents/agents.js')).href
    );
    const names = z
      .object({ agents: z.array(z.object({ name: z.string() })) })
      .parse(discovery.discoverAgents(root, 'both'))
      .agents.map((agent) => agent.name);
    expect(externalCliSubagents()).toContain('codex-exec');
    expect(names).toContain('worker');
    expect(names.filter((name) => externalCliSubagents().includes(name))).toEqual([]);
  });

  it('blocks a destructive shell command through the safety floor without asking', async () => {
    const asked: unknown[] = [];
    const f = await fixture({
      request: (async (_method: string, params: unknown) => {
        asked.push(params);
        return { action: 'cancel' };
      }) as AdapterPeer['request'],
      responses: [call('bash', { command: 'rm -rf ~' }), fauxAssistantMessage('Stopped.')],
    });
    await useProfile(f.agentDir);
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Go' }] });
    expect(asked).toEqual([]);
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({ sessionUpdate: 'tool_call_update', status: 'failed' }),
      })
    );
    expect(f.prompts[1]).toContain('CC Safety Net');
  });

  it('answers the published question tool through the GUI form dialog', async () => {
    const f = await fixture({
      request: (async (_method: string, params: unknown) => {
        const form = params as Extract<CreateElicitationRequest, { mode: 'form' }>;
        const schema = z
          .object({ properties: z.record(z.string(), z.object({ enum: z.array(z.string()) })) })
          .parse(form.requestedSchema);
        const [key, field] = Object.entries(schema.properties)[0]!;
        return { action: 'accept', content: { [key]: field.enum[0] } };
      }) as AdapterPeer['request'],
      responses: [
        call('ask_user_question', {
          questions: [
            {
              question: 'Which palette?',
              header: 'Palette',
              options: [
                { label: 'Warm', description: 'Warm tones' },
                { label: 'Cool', description: 'Cool tones' },
              ],
            },
          ],
        }),
        fauxAssistantMessage('Chosen.'),
      ],
    });
    await useProfile(f.agentDir);
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Ask' }] });
    const answered = JSON.stringify(
      f.updates.filter((entry) => entry.update.sessionUpdate === 'tool_call_update')
    );
    expect(answered).toContain('"status":"completed"');
    expect(answered).toContain(String.raw`\"Which palette?\"=\"Warm\"`);
  });
});
