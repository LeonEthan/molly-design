#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const forbiddenPathPrefixes = [
  'backend/',
  'apps/mobile/',
  'apps/web/',
  'context/',
  'docs/',
  'plans/',
  'site/',
  'tasks/',
];
const sourceExtensions = new Set(['.cjs', '.cts', '.go', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const documentationExtensions = new Set(['.md', '.mdx']);
const privateRecordPathPrefixes = ['context/', 'docs/', 'plans/', 'tasks/'];
const publishableTextExtensions = new Set([
  ...sourceExtensions,
  ...documentationExtensions,
  '.json',
  '.jsonc',
  '.mod',
  '.sum',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);
const forbiddenGoModulePattern =
  /(?:@lody\/convex|github\.com\/LodyAI\/|backend\/(?:convex|server|do)|github\.com\/getsentry\/sentry-go|github\.com\/posthog\/posthog-go|github\.com\/mixpanel\/mixpanel-go)/u;
const forbiddenGoReplacePattern = /^\s*replace\b[^\n]*(?:=>\s*(?:\/|\.\.\/.*backend\/))/gmu;
const forbiddenGoImportPattern =
  /"[^"]*(?:backend\/(?:convex|server|do)|github\.com\/getsentry\/sentry-go|github\.com\/posthog\/posthog-go|github\.com\/mixpanel\/mixpanel-go)[^"]*"/u;
const forbiddenGoCloudBuildTagPattern = /^\/\/go:build\s+cloud\b/mu;
const documentationBoundaryAllowlist = new Set(['AGENTS.md']);
// Real developer/machine identities observed in this project's history. The
// repo's placeholder convention (alice, developer, x, …) stays allowed, so a
// new genuine identity must be added here the moment it first leaks.
const internalPathPattern = /\/Users\/(?:leon|zxch3n|macmini)|\/home\/zxch3n|github---loro-dev---lody/u;
const hostedPresetPattern =
  /lody-server\.zx-073\.workers\.dev|main\.lody\.pages\.dev|impressive-guineapig-165|gateway\.lody\.uk|api\.streams-api-x\.loro\.dev|streams-api-proxy\.loro\.dev|convex\.lody\.ai|m\.lody\.ai|npmmirror\.com/u;
const publicRuntimeArtifactHostPattern = /api\.lody\.ai/u;
const publicRuntimeArtifactHostAllowlist = new Set([
  'README.md',
  'packages/platform/src/runtime-artifacts.ts',
]);
const hostedScriptNamePattern = /(?:^|:)(?:cloud|prod|production|staging)(?:$|:)/u;

export function checkGoModContent(file, content) {
  const issues = [];
  if (forbiddenGoModulePattern.test(content)) {
    issues.push(`${file}: Go module references a private, closed or telemetry package`);
  }
  forbiddenGoReplacePattern.lastIndex = 0;
  if (forbiddenGoReplacePattern.test(content)) {
    issues.push(`${file}: Go module replace targets an internal absolute or closed backend path`);
  }
  return issues;
}

export function checkGoSourceContent(file, content) {
  const issues = [];
  if (forbiddenGoImportPattern.test(content)) {
    issues.push(`${file}: Go source imports a closed backend or telemetry package`);
  }
  if (forbiddenGoCloudBuildTagPattern.test(content)) {
    issues.push(`${file}: cloud-tagged Go source is not allowed in the public OSS repository`);
  }
  return issues;
}

function listRepositoryFiles() {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(path.join(repoRoot, file)))
    .sort();
}

async function main() {
  const files = listRepositoryFiles();
  const violations = [];

  for (const file of files) {
    if (forbiddenPathPrefixes.some((prefix) => file.startsWith(prefix))) {
      violations.push(`${file}: closed product path is not allowed`);
    }
  }

  const manifests = files.filter((file) => path.posix.basename(file) === 'package.json');
  if (existsSync(path.join(repoRoot, '.gitmodules'))) {
    const gitmodules = await readFile(path.join(repoRoot, '.gitmodules'), 'utf8');
    for (const match of gitmodules.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gmu)) {
      const manifest = `${match[1]}/package.json`;
      if (existsSync(path.join(repoRoot, manifest))) manifests.push(manifest);
    }
  }
  const workspaceNames = new Set();
  const parsedManifests = [];
  for (const file of manifests) {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
    parsedManifests.push({ file, manifest });
    if (typeof manifest.name === 'string') workspaceNames.add(manifest.name);
  }

  for (const { file, manifest } of parsedManifests) {
    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (name === '@lody/convex') {
          violations.push(`${file}: ${field}.${name} is a private workspace dependency`);
        }
        if (
          typeof version === 'string' &&
          version.startsWith('workspace:') &&
          !workspaceNames.has(name)
        ) {
          violations.push(
            `${file}: ${field}.${name}=${version} does not resolve in this repository`
          );
        }
      }
    }
    for (const scriptName of Object.keys(manifest.scripts ?? {})) {
      if (hostedScriptNamePattern.test(scriptName)) {
        violations.push(`${file}: hosted deployment script ${scriptName} is not public`);
      }
    }
  }

  for (const file of files) {
    if (path.posix.basename(file) === 'go.mod') {
      const content = await readFile(path.join(repoRoot, file), 'utf8');
      violations.push(...checkGoModContent(file, content));
      continue;
    }
    if (!sourceExtensions.has(path.extname(file))) continue;
    if (file === 'scripts/check-public-boundary.mjs') continue;
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    if (path.extname(file) === '.go') {
      violations.push(...checkGoSourceContent(file, content));
      continue;
    }
    if (/['"]@lody\/convex['"]/u.test(content)) {
      violations.push(`${file}: source imports private @lody/convex`);
    }
    if (/from\s+['"][^'"]*backend\//u.test(content)) {
      violations.push(`${file}: source imports a closed backend path`);
    }
  }

  for (const file of files) {
    if (!publishableTextExtensions.has(path.extname(file))) continue;
    if (file === 'scripts/check-public-boundary.mjs') continue;
    if (path.posix.basename(file) === 'CLAUDE.md') continue;
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    if (internalPathPattern.test(content)) {
      violations.push(`${file}: publishable text contains an internal absolute path`);
    }
    if (hostedPresetPattern.test(content)) {
      violations.push(`${file}: publishable text contains a hosted deployment preset`);
    }
    if (
      publicRuntimeArtifactHostPattern.test(content) &&
      !publicRuntimeArtifactHostAllowlist.has(file)
    ) {
      violations.push(`${file}: public runtime artifact host is outside its allowlisted owners`);
    }
  }

  for (const file of files) {
    if (!documentationExtensions.has(path.extname(file))) continue;
    if (path.posix.basename(file) === 'CLAUDE.md') continue;
    if (documentationBoundaryAllowlist.has(file)) continue;
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    if (
      /@lody\/convex|backend\/(?:convex|server|do)|apps\/(?:mobile|web)|site\/docs/u.test(content)
    ) {
      violations.push(`${file}: documentation references a closed implementation path`);
    }
    for (const match of content.matchAll(/\]\(([^)\s#?]+)(?:[?#][^)]*)?\)/gu)) {
      const target = match[1];
      if (/^(?:[a-z]+:|\/)/iu.test(target)) continue;
      const resolvedTarget = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), target)
      );
      if (privateRecordPathPrefixes.some((prefix) => resolvedTarget.startsWith(prefix))) {
        violations.push(`${file}: link targets private record ${resolvedTarget}`);
      }
    }
  }

  // Transcript-shaped fixtures are never publishable: raw `.jsonl` captures and
  // the historical `*.captured.json` naming (retired in favor of `.sample.json`)
  // both suggest real recorded sessions. Synthetic fixtures use `.sample.json`.
  const capturedFixtures = files.filter(
    (file) =>
      (file.endsWith('.jsonl') || file.endsWith('.captured.json')) &&
      (file.includes('/stories/fixtures/') || file.includes('/tests/fixtures/'))
  );
  for (const file of capturedFixtures) {
    violations.push(`${file}: captured transcript fixtures are not publishable`);
  }

  if (violations.length > 0) {
    console.error('Public repository boundary check failed:');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Public repository boundary passed (${files.length} files, ${manifests.length} manifests).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
