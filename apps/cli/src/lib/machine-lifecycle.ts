import { z } from 'zod';
import {
  deriveConvexSiteUrl,
  type MachineLifecycleCapability,
  normalizeBaseUrl,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';
import {
  CLI_EXIT_CODE_AUTH_FAILURE,
  CLI_EXIT_CODE_REMOTE_RESTART,
  CLI_EXIT_CODE_RETRYABLE_STARTUP,
  CLI_EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH,
} from '@molly/shared/node/local-cli-supervisor';
import { MOLLY_AUTH_SITE_URL, MOLLY_AUTH_URL } from '@/utils/const';

// The reserved Worker exit codes are part of the shared Supervisor<->Worker
// contract; Electron consumes the same values from @molly/shared. Exit code 43
// (remote upgrade) is retired with the upgrade machinery.
export const EXIT_CODE_RETRYABLE_STARTUP = CLI_EXIT_CODE_RETRYABLE_STARTUP;
export const EXIT_CODE_REMOTE_RESTART = CLI_EXIT_CODE_REMOTE_RESTART;
export const EXIT_CODE_AUTH_FAILURE = CLI_EXIT_CODE_AUTH_FAILURE;
export const EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH = CLI_EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH;
export const MOLLY_DAEMON_SUPERVISED_ENV = 'MOLLY_DAEMON_SUPERVISED';

// Remote upgrade is retired, not gated: the npm `lody` package belongs to a
// third party, so the old self-upgrade would have installed and executed code
// Molly does not control, and this local-only product has no package channel of
// its own. Updates ship through the desktop release channel instead.
export type MachineLifecycleAction = 'restart';

export type MachineProcessLifecycleAction = {
  action: 'restart';
  exitCode: typeof EXIT_CODE_REMOTE_RESTART;
  requestId: string;
};

export const resolveMachineLifecycleCapability = (
  launchMode: 'daemon' | 'electron' | undefined
): MachineLifecycleCapability => {
  if (launchMode === 'electron') {
    return {
      launchMode: 'electron',
      canRemoteRestart: false,
      reason: 'electron',
    };
  }

  if (launchMode === 'daemon') {
    return {
      launchMode: 'daemon',
      canRemoteRestart: true,
    };
  }

  return {
    launchMode: 'foreground',
    canRemoteRestart: false,
    reason: 'not_daemon',
  };
};

const MachineLifecycleVerifyResponseSchema = z
  .object({
    valid: z.literal(true),
    requesterUserId: z.string().trim().min(1),
  })
  .strict();

const resolveConvexSiteUrl = (): string | null => {
  if (MOLLY_AUTH_SITE_URL) {
    return normalizeBaseUrl(MOLLY_AUTH_SITE_URL);
  }
  if (MOLLY_AUTH_URL) {
    return normalizeBaseUrl(deriveConvexSiteUrl(normalizeBaseUrl(MOLLY_AUTH_URL)));
  }
  return null;
};

export const verifyMachineLifecycleRequest = async (args: {
  token: string;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  action: MachineLifecycleAction;
  requesterUserId: string;
  requestId: string;
  requestToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number; retriable?: boolean }> => {
  const siteUrl = resolveConvexSiteUrl();
  if (!siteUrl) {
    return { ok: false, error: 'Molly auth URL is not configured on this machine.' };
  }

  try {
    const response = await (args.fetchImpl ?? fetch)(`${siteUrl}/api/machine-lifecycle/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        workspaceId: args.workspaceId,
        machineId: args.machineId,
        action: args.action,
        requesterUserId: args.requesterUserId,
        requestId: args.requestId,
        requestToken: args.requestToken,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Machine lifecycle verification failed with status ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        status: response.status,
        retriable: response.status >= 500,
      };
    }

    const parsed = MachineLifecycleVerifyResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { ok: false, error: 'Machine lifecycle verification returned an invalid response.' };
    }
    if (parsed.data.requesterUserId !== args.requesterUserId) {
      return { ok: false, error: 'Machine lifecycle verification requester mismatch.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retriable: true,
    };
  }
};
