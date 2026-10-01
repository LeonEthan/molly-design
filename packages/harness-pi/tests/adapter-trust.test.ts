import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures/adapter';
import { createProfileSettings } from '../src/profile-settings';

async function prepareProject(
  f: Awaited<ReturnType<typeof fixture>>,
  defaultProjectTrust: 'always' | 'never' | 'ask'
) {
  await writeFile(
    join(f.agentDir, 'settings.json'),
    JSON.stringify({
      defaultProjectTrust,
      enableSkillCommands: true,
      retry: { enabled: false },
      compaction: { enabled: false },
    })
  );
  const globalSkillDir = join(f.agentDir, 'skills', 'trust-global-proof');
  await mkdir(globalSkillDir, { recursive: true });
  await writeFile(
    join(globalSkillDir, 'SKILL.md'),
    '---\nname: trust-global-proof\ndescription: Synthetic global trust proof\n---\nGLOBAL_TRUST_PROOF'
  );
  const projectExtensions = join(f.cwd, '.pi', 'extensions');
  await mkdir(projectExtensions, { recursive: true });
  await writeFile(
    join(f.cwd, '.pi', 'settings.json'),
    JSON.stringify({ enableSkillCommands: false })
  );
  const signalFile = join(f.cwd, 'project-extension-executed.txt');
  await writeFile(
    join(projectExtensions, 'trust-proof.js'),
    `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(signalFile)}, 'PROJECT_EXTENSION_EXECUTED');
export default function(pi) {
  pi.registerCommand('project-trust-proof', {
    description: 'Synthetic project trust proof',
    handler: async (_args, ctx) => ctx.ui.notify('PROJECT_TRUST_PROOF')
  });
}
`
  );
  return signalFile;
}

function commands(updates: SessionNotification[]) {
  return updates.flatMap(({ update }) =>
    update.sessionUpdate === 'available_commands_update'
      ? update.availableCommands.map((command) => command.name)
      : []
  );
}

describe('owned ACP native project trust', () => {
  it('discovers text skills without executing project code in the shipped profile', async () => {
    const f = await fixture();
    const signalFile = await prepareProject(f, 'never');
    await writeFile(
      join(f.agentDir, 'settings.json'),
      JSON.stringify({
        ...createProfileSettings(),
        retry: { enabled: false },
        compaction: { enabled: false },
      })
    );
    const skillDir = join(f.cwd, '.agents', 'skills', 'project-text-proof');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: project-text-proof\ndescription: Synthetic text skill\n---\nPROJECT_TEXT_PROOF'
    );
    await f.initialize();
    await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await expect(readFile(signalFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commands(f.updates)).not.toContain('project-trust-proof');
    expect(commands(f.updates)).toContain('skill:project-text-proof');
    expect(commands(f.updates)).toContain('skill:trust-global-proof');
    expect(new ProjectTrustStore(f.agentDir).get(f.cwd)).toBeNull();
    expect(f.prompts).toEqual([]);
  });

  it.each(['never', 'ask'] as const)(
    'does not execute project code or load project settings with default %s',
    async (defaultProjectTrust) => {
      const f = await fixture();
      const signalFile = await prepareProject(f, defaultProjectTrust);
      await f.initialize();
      await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
      await expect(readFile(signalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(commands(f.updates)).not.toContain('project-trust-proof');
      expect(commands(f.updates)).toContain('skill:trust-global-proof');
      expect(new ProjectTrustStore(f.agentDir).get(f.cwd)).toBeNull();
      expect(f.prompts).toEqual([]);
    }
  );

  it('honors a native saved trust grant before the global never default', async () => {
    const f = await fixture();
    const signalFile = await prepareProject(f, 'never');
    new ProjectTrustStore(f.agentDir).set(f.cwd, true);
    await f.initialize();
    await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    expect(await readFile(signalFile, 'utf8')).toBe('PROJECT_EXTENSION_EXECUTED');
    expect(commands(f.updates)).toContain('project-trust-proof');
    expect(commands(f.updates)).not.toContain('skill:trust-global-proof');
    expect(new ProjectTrustStore(f.agentDir).get(f.cwd)).toBe(true);
    expect(f.prompts).toEqual([]);
  });

  it('honors a native saved denial before the global always default', async () => {
    const f = await fixture();
    const signalFile = await prepareProject(f, 'always');
    new ProjectTrustStore(f.agentDir).set(f.cwd, false);
    await f.initialize();
    await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await expect(readFile(signalFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commands(f.updates)).not.toContain('project-trust-proof');
    expect(commands(f.updates)).toContain('skill:trust-global-proof');
    expect(new ProjectTrustStore(f.agentDir).get(f.cwd)).toBe(false);
    expect(f.prompts).toEqual([]);
  });

  it('refuses unsupported bootstrap trust hooks before loading project code', async () => {
    const f = await fixture({
      extensions: [
        (pi) => {
          pi.on('project_trust', async () => ({ trusted: 'no' }));
        },
      ],
    });
    const signalFile = await prepareProject(f, 'always');
    await f.initialize();
    await expect(f.agent.newSession({ cwd: f.cwd, mcpServers: [] })).rejects.toThrow(
      'pi_acp_session_setup_failed'
    );
    await expect(readFile(signalFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.prompts).toEqual([]);
  });
});
