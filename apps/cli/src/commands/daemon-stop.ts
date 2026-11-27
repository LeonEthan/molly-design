import {
  getLocalCliHostEndpoint,
  inspectLocalCliHost,
  requestLocalCliHostShutdown,
  type LocalCliHostRecord,
} from '@molly/shared/node/local-cli-host-lease';
import {
  resolveIsolatedDataPath,
  getMollyDataDir,
  getInstallationProfile,
} from '@molly/shared/node/installation-profile';
import { readPidFileRecord } from './daemon-shared';

type StopResult =
  | { status: 'not_running' }
  | { status: 'stale_pid_file'; pid: number }
  | { status: 'stopped'; pid: number; attempts: number }
  | { status: 'timeout'; pid: number; attempts: number }
  | { status: 'host_mismatch'; pid: number; host: LocalCliHostRecord }
  | { status: 'control_error'; pid: number; errorMessage: string };

export async function stopDaemonProcess(): Promise<StopResult> {
  const pidRecord = readPidFileRecord(resolveIsolatedDataPath(getMollyDataDir(), 'daemon.pid'));
  if (!pidRecord) return { status: 'not_running' };
  const pid = pidRecord.pid;

  let endpoint = getLocalCliHostEndpoint();
  let host = await inspectLocalCliHost(endpoint, 500);
  const matchesDaemon = (record: LocalCliHostRecord | null) =>
    record?.mode === 'daemon' && record.pid === pid && record.instanceId === pidRecord.instanceId;
  const profile = getInstallationProfile();
  if (
    !matchesDaemon(host) &&
    profile.platform === 'local' &&
    (process.env.MOLLY_E2E ?? process.env.LODY_E2E) !== '1'
  ) {
    const baseline = getLocalCliHostEndpoint(undefined, false);
    const candidates = [];
    if (endpoint.kind === 'tcp') {
      if (endpoint.port !== profile.localCliHostPort)
        candidates.push({
          kind: 'tcp',
          host: '127.0.0.1',
          port: profile.localCliHostPort,
        } as const);
      if (profile.channel === 'stable' && endpoint.port !== 17790)
        candidates.push({ kind: 'tcp', host: '127.0.0.1', port: 17790 } as const);
    } else if (baseline.kind === 'pipe' && baseline.path !== endpoint.path) {
      candidates.push(baseline);
    }
    for (const candidate of candidates) {
      const observed = await inspectLocalCliHost(candidate, 500);
      if (matchesDaemon(observed)) {
        endpoint = candidate;
        host = observed;
        break;
      }
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
