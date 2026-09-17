
export type MachineLifecycleAction = 'restart' | 'upgrade';

export type MintMachineLifecycleRequestTokenResult =
  | { ok: true; requestToken: string; requesterUserId: string }
  | { ok: false; error: string };

export type FetchLatestCliVersionResult =
  | { ok: true; latestVersion: string; cacheTtlMs?: number }
  | { ok: false; error: string };

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function parseSemver(value: string): ParsedSemver | null {
  const match = value.trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function comparePrerelease(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function isCliVersionOutdated(currentVersion?: string, latestVersion?: string): boolean {
  if (!currentVersion || !latestVersion) return false;
  const current = parseSemver(currentVersion);
  const latest = parseSemver(latestVersion);
  if (!current || !latest) return false;
  for (const key of ['major', 'minor', 'patch'] as const) {
    const delta = latest[key] - current[key];
    if (delta > 0) return true;
    if (delta < 0) return false;
  }
  return comparePrerelease(current.prerelease, latest.prerelease) < 0;
}

/** Hosted lifecycle authorization is outside the local desktop product. */
export async function mintMachineLifecycleRequestToken(_args: {
  workspaceId: string;
  machineId: string;
  action: MachineLifecycleAction;
  requestId: string;
  targetVersion?: string;
  sessionToken: string;
  authBaseUrl?: string;
}): Promise<MintMachineLifecycleRequestTokenResult> {
  return { ok: false, error: 'Remote Machine lifecycle is unavailable in Molly' };
}

export async function fetchLatestCliVersion(
  _args: { authBaseUrl?: string } = {}
): Promise<FetchLatestCliVersionResult> {
  return { ok: false, error: 'Remote CLI version lookup is unavailable in Molly' };
}
