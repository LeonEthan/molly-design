import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Reject stale external launchers as well as freshly emitted ones before shipping. */
export function assertNoLegacyHarnessArtifacts(cliDirectory) {
  const forbidden = [
    ...['claude', 'codex', 'grok', 'deepseek'].flatMap((agent) => [
      `${agent}-acp.js`,
      `${agent}-acp.js.map`,
    ]),
    ...[
      'pi-design-launcher',
      'pi-design-extension',
      'pi-mcp-extension',
      'codex-design-reminder',
      'grok-design-reminder',
      'claude-design-hook',
    ].flatMap((entry) => [`${entry}.js`, `${entry}.js.map`]),
    'deepseek-agent-presets',
  ];
  const present = forbidden.filter((name) => fs.existsSync(path.join(cliDirectory, name)));
  if (present.length > 0)
    throw new Error(`Retired harness artifacts remain; rebuild CLI cleanly: ${present.join(', ')}`);
}

export function verifyEmbeddedHarness(directory) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'runtime-manifest.json'), 'utf8')
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.protocolVersion !== 1 ||
    manifest.engineVersion !== '0.85.1' ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.packages)
  )
    throw new Error('Unsupported embedded harness manifest');
  const root = fs.realpathSync(directory);
  const listed = new Set();
  for (const file of manifest.files) {
    if (
      typeof file.path !== 'string' ||
      file.path.includes('\\') ||
      path.isAbsolute(file.path) ||
      file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      listed.has(file.path)
    ) {
      throw new Error('Invalid embedded harness resource path');
    }
    listed.add(file.path);
    const location = path.join(root, file.path);
    if (
      !fs.lstatSync(location).isFile() ||
      !fs.realpathSync(location).startsWith(`${root}${path.sep}`)
    ) {
      throw new Error(`Invalid embedded harness resource: ${file.path}`);
    }
    if (createHash('sha256').update(fs.readFileSync(location)).digest('hex') !== file.sha256) {
      throw new Error(`Embedded harness resource changed: ${file.path}`);
    }
  }
  function checkExtras(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const location = path.join(current, entry.name);
      if (entry.isDirectory()) checkExtras(location);
      else {
        const relative = path.relative(root, location).split(path.sep).join('/');
        if (!entry.isFile() || (relative !== 'runtime-manifest.json' && !listed.has(relative))) {
          throw new Error(`Unlisted embedded harness resource: ${relative}`);
        }
      }
    }
  }
  checkExtras(root);
  if (
    manifest.buildId !== createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')
  ) {
    throw new Error('Embedded harness build digest mismatch');
  }
  for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai']) {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')
    );
    if (metadata.version !== manifest.engineVersion) throw new Error(`Unreviewed engine ${name}`);
  }
  const mcp = JSON.parse(
    fs.readFileSync(
      path.join(root, 'node_modules', '@modelcontextprotocol/sdk', 'package.json'),
      'utf8'
    )
  );
  if (mcp.version !== '1.29.0') throw new Error('Unreviewed MCP SDK');
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const manifest = verifyEmbeddedHarness(path.resolve(process.argv[2] ?? 'apps/cli/dist/harness'));
  console.log(`Verified embedded Pi ${manifest.engineVersion}: ${manifest.files.length} resources`);
}
