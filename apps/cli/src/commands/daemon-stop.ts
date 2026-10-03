import {
  getLocalCliHostEndpoint,
  inspectLocalCliHost,
  requestLocalCliHostShutdown,
  type LocalCliHostRecord,
} from '@molly/shared/node/local-cli-host-lease';
import { getInstallationProfile } from '@molly/shared/node/installation-profile';
import { readPidFileRecord } from './daemon-shared';

type StopResult =
  | { status: 'not_running' }
  | { status: 'stale_pid_file'; pid: number }
  | { status: 'stopped'; pid: number; attempts: number }
  | { status: 'timeout'; pid: number; attempts: number }
  | { status: 'host_mismatch'; pid: number; host: LocalCliHostRecord }
  | { status: 'control_error'; pid: number; errorMessage: string };

export async function stopDaemonProcess(): Promise<StopResult> {
  const pidRecord = readPidFileRecord();
  if (!pidRecord) return { status: 'not_running' };
  const pid = pidRecord.pid;

  let endpoint = getLocalCliHostEndpoint();
  let host = await inspectLocalCliHost(endpoint, 500);
  const matchesDaemon = (record: LocalCliHostRecord | null) =>
    record?.mode === 'daemon' && record.pid === pid && record.instanceId === pidRecord.instanceId;
  if (
    !matchesDaemon(host) &&
    getInstallationProfile().platform === 'local' &&
    endpoint.kind === 'tcp' &&
    endpoint.host === '127.0.0.1' &&
    endpoint.port === 17_792 &&
    (process.env.MOLLY_E2E ?? process.env.LODY_E2E) !== '1'
  ) {
    const legacyEndpoint = { kind: 'tcp', host: '127.0.0.1', port: 17_790 } as const;
    const legacyHost = await inspectLocalCliHost(legacyEndpoint, 500);
    if (matchesDaemon(legacyHost)) {
      endpoint = legacyEndpoint;
      host = legacyHost;
    }
  }
  if (!host) {
    return { status: 'stale_pid_file', pid };
  }
  if (!matchesDaemon(host)) {
    return { status: 'host_mismatch', pid, host };
  }

  const requested = await requestLocalCliHostShutdown({
    instanceId: pidRecord.instanceId,
    token: pidRecord.controlToken,
    expectedPid: pid,
    expectedMode: 'daemon',
    endpoint,
  });
  if (!requested.ok) {
    return { status: 'control_error', pid, errorMessage: requested.error };
  }

  const maxAttempts = 80;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const currentHost = await inspectLocalCliHost(endpoint, 500);
    if (!currentHost || currentHost.instanceId !== pidRecord.instanceId) {
      return { status: 'stopped', pid, attempts: attempt };
    }
  }
  return { status: 'timeout', pid, attempts: maxAttempts };
}
