import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const harnessRoot = path.resolve(cliRoot, '../../packages/harness-pi');
const pinnedRuntimePackages = {
  '@earendil-works/pi-coding-agent': '0.85.1',
  '@earendil-works/pi-ai': '0.85.1',
  '@modelcontextprotocol/sdk': '1.29.0',
  '@anthropic-ai/sandbox-runtime': '0.0.77',
  typebox: '1.3.7',
};
const curatedExtensions = [
  { name: 'pi-ask-question', entry: 'ask-question.ts' },
  { name: 'pi-auto-approval', entry: 'review.ts' },
];
const external = Object.keys(pinnedRuntimePackages);

function resolvePackage(name, parent) {
  const require = createRequire(path.join(parent, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  throw new Error(`Missing locked runtime dependency ${name}`);
}

/** Stage ordinary directories, not development/pnpm symlinks, with version-aware lookup. */
function stageClosure(root, roots) {
  const sources = new Map();
  const processed = new Set();
  const packages = [];
  function allocate(name, sourceParent, targetParent) {
    const source = resolvePackage(name, sourceParent);
    let current = targetParent;
    let found;
    while (current.startsWith(root)) {
      const candidate = path.join(current, 'node_modules', name);
      if (sources.has(candidate)) {
        found = candidate;
        break;
      }
      if (current === root) break;
      current = path.dirname(current);
    }
    if (found && sources.get(found) === source) return found;
    const target = path.join(found ? targetParent : root, 'node_modules', name);
    if (sources.has(target) && sources.get(target) !== source)
      throw new Error(`Ambiguous package closure: ${name}`);
    if (!sources.has(target)) {
      if (sources.size > 1500) throw new Error('Unexpected runtime dependency cycle/size');
      sources.set(target, source);
      fs.cpSync(source, target, {
        recursive: true,
        dereference: true,
        filter: (entry) =>
          entry === source ||
          (!entry.endsWith('.map') &&
            !path
              .relative(source, entry)
              .split(path.sep)
              .some((part) => part === 'node_modules' || part === '.git')),
      });
      const metadata = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      packages.push({
        name: metadata.name,
        version: metadata.version,
        path: path.relative(root, target),
      });
    }
    return target;
  }
  function visit(target) {
    if (processed.has(target)) return;
    processed.add(target);
    const source = sources.get(target);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const children = [];
    const dependencies = {
      ...metadata.peerDependencies,
      ...metadata.optionalDependencies,
      ...metadata.dependencies,
    };
    for (const name of Object.keys(dependencies ?? {}).sort()) {
      const optional =
        name in (metadata.optionalDependencies ?? {}) ||
        metadata.peerDependenciesMeta?.[name]?.optional;
      try {
        children.push(allocate(name, source, target));
      } catch (error) {
        if (!optional || !error.message.startsWith('Missing locked runtime dependency'))
          throw error;
      }
    }
    // Resolve all ancestor edges before descendants, so a later version override
    // cannot silently shadow an already staged child's dependency.
    children.forEach(visit);
  }
  const top = roots.map((name) => allocate(name, harnessRoot, root));
  top.forEach(visit);
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

function fileDigests(root, directory = root) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) return fileDigests(root, location);
      if (!entry.isFile()) throw new Error(`Non-portable runtime resource ${location}`);
      return [
        {
          path: path.relative(root, location).split(path.sep).join('/'),
          sha256: createHash('sha256').update(fs.readFileSync(location)).digest('hex'),
        },
      ];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildEmbeddedHarness(outputName = 'dist') {
  if (!['dist', 'dist-dev'].includes(outputName)) throw new Error('Invalid owned output directory');
  for (const extension of curatedExtensions) {
    const extensionRoot = path.join(harnessRoot, 'vendor', extension.name);
    const extensionManifest = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8')
    );
    for (const [file, expected] of [
      [extension.entry, extensionManifest.adaptedSha256],
      ['LICENSE', extensionManifest.licenseSha256],
    ]) {
      const actual = createHash('sha256')
        .update(fs.readFileSync(path.join(extensionRoot, file)))
        .digest('hex');
      if (actual !== expected)
        throw new Error(`Unreviewed curated extension content: ${extension.name}/${file}`);
    }
  }
  const output = path.join(cliRoot, outputName);
  const directory = path.join(output, 'harness');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  await build({
    entryPoints: [
      path.join(harnessRoot, 'src/worker-entry.ts'),
      path.join(harnessRoot, 'src/model-catalog.ts'),
    ],
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22.19',
    splitting: true,
    external,
    sourcemap: false,
    chunkNames: 'chunks/[name]-[hash]',
  });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' })
  );
  const packages = stageClosure(directory, external);
  for (const name of external) {
    const pinned = packages.find((entry) => entry.path === path.join('node_modules', name));
    if (pinned?.version !== pinnedRuntimePackages[name])
      throw new Error(`Unreviewed runtime dependency version: ${name}`);
  }
  const { createBundledModelCatalog } = await import(
    pathToFileURL(path.join(directory, 'model-catalog.js')).href
  );
  fs.writeFileSync(
    path.join(directory, 'model-catalog.json'),
    `${JSON.stringify(await createBundledModelCatalog())}\n`
  );
  for (const extension of curatedExtensions) {
    const extensionResources = path.join(directory, 'extensions', extension.name);
    fs.mkdirSync(extensionResources, { recursive: true });
    for (const file of ['LICENSE', 'manifest.json']) {
      fs.copyFileSync(
        path.join(harnessRoot, 'vendor', extension.name, file),
        path.join(extensionResources, file)
      );
    }
  }
  const files = fileDigests(directory);
  const manifest = {
    schemaVersion: 1,
    engine: 'pi',
    engineVersion: '0.85.1',
    protocolVersion: 1,
    minimumNode: '22.19.0',
    buildPlatform: process.platform,
    buildArch: process.arch,
    lockSha256: createHash('sha256')
      .update(fs.readFileSync(path.resolve(cliRoot, '../../pnpm-lock.yaml')))
      .digest('hex'),
    buildId: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    packages,
    files,
  };
  fs.writeFileSync(
    path.join(directory, 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(output, 'molly-pi-agent.js'),
    "await import('./harness/worker-entry.js');\n"
  );
  console.log(
    `Embedded Pi ${manifest.engineVersion}: ${packages.length} locked packages, ${files.length} resources (${outputName})`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await buildEmbeddedHarness(process.argv[2] ?? 'dist');
}
