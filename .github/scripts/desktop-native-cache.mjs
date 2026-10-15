import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
  agentBrowserCacheInputs,
  agentBrowserResources,
  verifyAgentBrowser,
} from '../../apps/electron/scripts/agent-browser-resources.mjs';
import {
  browserCookieReaderCacheInputs,
  browserCookieReaderResources,
  verifyBrowserCookieReader,
} from '../../apps/electron/scripts/browser-cookie-reader-resources.mjs';
import {
  logNativeResource,
  nativeResourceCacheKey,
  probeNativeBuildHost,
} from '../../apps/electron/scripts/native-resource-cache.mjs';

export const NATIVE_RESOURCES = [
  {
    output: 'agent-browser',
    environment: 'AGENT_BROWSER',
    inputs: agentBrowserCacheInputs,
    directory: agentBrowserResources,
    verify: verifyAgentBrowser,
  },
  {
    output: 'browser-cookie-reader',
    environment: 'BROWSER_COOKIE_READER',
    inputs: browserCookieReaderCacheInputs,
    directory: browserCookieReaderResources,
    verify: verifyBrowserCookieReader,
  },
];

export function restoreOutcome(mode, { hit, requestedKey, matchedKey }) {
  if (mode === 'cold') return 'skipped-cold';
  if (!matchedKey) return 'miss';
  return hit === 'true' && requestedKey && matchedKey === requestedKey ? 'hit' : 'rejected-key';
}

export function nativeCacheKeys(probe) {
  return NATIVE_RESOURCES.map((resource) => [
    resource.output,
    nativeResourceCacheKey(resource.inputs, probe),
  ]);
}

function appendOutput(lines) {
  const text = `${lines.join('\n')}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
  else process.stdout.write(text);
}

export function acceptRestores(
  env,
  nowMs,
  { log = console.log, resources = NATIVE_RESOURCES } = {}
) {
  const startedAt = Number(env.NATIVE_CACHE_RESTORE_STARTED_AT);
  const durationMs = Number.isFinite(startedAt) ? Math.max(0, nowMs - startedAt) : 'unknown';
  log(`[native-cache] pnpm-cache=${env.PNPM_CACHE_HIT === 'true' ? 'hit' : 'miss'}`);
  for (const resource of resources) {
    const outcome = restoreOutcome(env.NATIVE_CACHE_MODE, {
      hit: env[`${resource.environment}_CACHE_HIT`],
      requestedKey: env[`${resource.environment}_CACHE_KEY`],
      matchedKey: env[`${resource.environment}_MATCHED_KEY`],
    });
    if (outcome !== 'hit') fs.rmSync(resource.directory, { recursive: true, force: true });
    log(`[native-cache] ${resource.output} restore=${outcome}`);
  }
  log(`[native-cache] restore durationMs=${durationMs}`);
}

export function readBuildReport(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function verifyForSave(
  target,
  builds,
  { log = console.log, now = () => performance.now(), resources = NATIVE_RESOURCES } = {}
) {
  let valid = true;
  const outputs = [];
  for (const resource of resources) {
    const started = now();
    let fresh = false;
    try {
      const manifest = resource.verify(resource.directory, target);
      fresh = builds.some(
        (build) => build.resource === resource.output && build.buildId === manifest.buildId
      );
      logNativeResource(
        resource.output,
        { saveGate: fresh ? 'fresh' : 'reused', durationMs: Math.round(now() - started) },
        log
      );
    } catch (error) {
      valid = false;
      logNativeResource(
        resource.output,
        { saveGate: 'rejected', reason: JSON.stringify(String(error?.message ?? error)) },
        log
      );
    }
    outputs.push(`${resource.output}-fresh=${fresh}`);
  }
  return { valid, outputs };
}

async function main(command) {
  switch (command) {
    case 'key': {
      const keys = nativeCacheKeys(probeNativeBuildHost());
      for (const [output, key] of keys) console.log(`[native-cache] ${output} key=${key}`);
      appendOutput([
        ...keys.map(([output, key]) => `${output}=${key}`),
        `started-at=${Date.now()}`,
      ]);
      return;
    }
    case 'accept-restore':
      acceptRestores(process.env, Date.now());
      return;
    case 'verify': {
      const { valid, outputs } = verifyForSave(
        { platform: process.platform, arch: process.arch },
        readBuildReport(process.env.MOLLY_NATIVE_BUILD_REPORT)
      );
      appendOutput(outputs);
      if (!valid) process.exitCode = 1;
      return;
    }
    default:
      throw new Error(`Usage: desktop-native-cache.mjs key|accept-restore|verify`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main(process.argv[2]);
