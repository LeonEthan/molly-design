/** Public immutable artifact distribution shared by local and cloud builds. */
export const DEFAULT_RUNTIME_ARTIFACTS_BASE_URL =
  'https://github.com/LeonEthan/molly-design/releases/download/runtime-artifacts-v1';

/** Release assets are flat; include all identity components to prevent collisions. */
export function runtimeReleaseAssetName(
  name: string,
  version: string,
  platformArch: string,
  fileName: string,
): string {
  return [name, version, platformArch, fileName].map(encodeURIComponent).join('--');
}

export function resolveRuntimeArtifactUrl(
  baseUrl: string,
  name: string,
  version: string,
  platformArch: string,
  fileName: string,
): string {
  const base = normalizeRuntimeArtifactsBaseUrl(baseUrl);
  const url = new URL(base);
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+$/.test(url.pathname)) {
    return `${base}/${runtimeReleaseAssetName(name, version, platformArch, fileName)}`;
  }
  // Preserve explicit mirrors using the existing public runtime endpoint contract.
  return `${base}/api/runtimes/${[name, version, platformArch, fileName].map(encodeURIComponent).join('/')}`;
}

export function normalizeRuntimeArtifactsBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '');
  if (!normalized) {
    throw new Error('Runtime artifacts base URL must not be empty');
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(`Invalid runtime artifacts base URL: ${value}`);
  }
  return normalized;
}

export function resolveRuntimeArtifactsBaseUrl(overrideBaseUrl?: string): string {
  if (overrideBaseUrl?.trim()) {
    return normalizeRuntimeArtifactsBaseUrl(overrideBaseUrl);
  }
  return DEFAULT_RUNTIME_ARTIFACTS_BASE_URL;
}
