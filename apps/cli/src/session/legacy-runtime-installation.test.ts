import { describe, expect, it } from 'vitest';
import {
  REGISTRY_ACP_AGENTS,
  MachineAcpBinaryInstallResponseSchema,
  MachineAcpBinaryStatusResponseSchema,
  type MachineAcpBinaryProgressMessage,
} from '@molly/shared';
import {
  SessionExecutionService,
  type SessionExecutionServiceDeps,
} from './session-execution-service';

// The compatibility handlers need only the destination identity: no filesystem,
// document manager, progress channel, network or runtime installer is available.
const service = () =>
  new SessionExecutionService({ machineId: 'machine-1' } as SessionExecutionServiceDeps);
const targets = [
  ...new Set([
    'kimi',
    'codex',
    'claude',
    'grok',
    'deepseek',
    'pi',
    'molly',
    'unknown-runtime',
    ...REGISTRY_ACP_AGENTS.map((agent) => agent.id),
  ]),
];

describe('retired runtime installation RPCs', () => {
  it.each(targets)(
    'refuses status and installation for %s without looking up or downloading a runtime',
    async (agentType) => {
      const runtime = service();
      const request = { machineId: 'machine-1', workspaceId: 'workspace-1', agentType };
      const progress: MachineAcpBinaryProgressMessage[] = [];
      const status = await runtime.getMachineAcpBinaryStatus({
        ...request,
        type: 'machine/acp-binary-status',
      });
      expect(MachineAcpBinaryStatusResponseSchema.parse(status)).toEqual({
        type: 'machine/acp-binary-status_response',
        machineId: 'machine-1',
        agentType,
        success: false,
        status: 'not-applicable',
        error: 'legacy_harness_installation_disabled',
      });
      const install = await runtime.installMachineAcpBinary(
        { ...request, type: 'machine/acp-binary-install' },
        { onAcpBinaryProgress: (event) => progress.push(event) }
      );
      expect(MachineAcpBinaryInstallResponseSchema.parse(install)).toEqual({
        type: 'machine/acp-binary-install_response',
        machineId: 'machine-1',
        agentType,
        success: false,
        error: 'legacy_harness_installation_disabled',
      });
      expect(progress).toEqual([]);
    }
  );

  it('rejects requests for another machine without advertising paths', async () => {
    const runtime = service();
    const request = { machineId: 'another-machine', workspaceId: 'workspace-1', agentType: 'kimi' };
    expect(
      await runtime.getMachineAcpBinaryStatus({ ...request, type: 'machine/acp-binary-status' })
    ).toEqual({
      type: 'machine/acp-binary-status_response',
      machineId: 'machine-1',
      agentType: 'kimi',
      success: false,
      status: 'not-applicable',
      error: 'machine_mismatch',
    });
    expect(
      await runtime.installMachineAcpBinary({ ...request, type: 'machine/acp-binary-install' })
    ).toEqual({
      type: 'machine/acp-binary-install_response',
      machineId: 'machine-1',
      agentType: 'kimi',
      success: false,
      error: 'machine_mismatch',
    });
  });
});
