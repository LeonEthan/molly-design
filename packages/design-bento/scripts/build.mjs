import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  cpSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Each isolated canvas owns its font faces; the React shell's fonts do not cross
// WebContents boundaries. Preserve Fontsource's script ranges and use offline WOFF2.
const interCss = ['400', '700', '400-italic', '700-italic']
  .map((face) =>
    readFileSync(require.resolve(`@fontsource/inter/${face}.css`), 'utf8').replace(
      /src: url\(\.\/files\/([^)]*\.woff2)\)[^;]*;/g,
      (_, file) =>
        `src: url(data:font/woff2;base64,${readFileSync(require.resolve(`@fontsource/inter/files/${file}`)).toString('base64')}) format('woff2');`
    )
  )
  .join('\n');

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source-manifest.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, SINGLEFILE: '1' } });
for (const [file, expected] of Object.entries(manifest.files)) {
  if (hash(readFileSync(join(root, file))) !== expected) throw Error(`Source pin changed: ${file}`);
}
// Windows TEMP may use an 8.3 alias; Vite module IDs must use one canonical path.
const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), 'molly-bento-')));
const tree = join(temporary, 'bento');
let registered = false;
try {
  run(
    'git',
    ['worktree', 'add', '--detach', '--no-checkout', tree, manifest.bentoCommit],
    join(root, 'bento')
  );
  registered = true;
  run('git', ['sparse-checkout', 'set', 'slides', 'kernel', 'scripts'], tree);
  run('git', ['checkout'], tree);
  for (const patch of manifest.patches)
    run('git', ['apply', '--whitespace=error', join(root, 'patches', patch)], tree);
  const destination = join(tree, 'slides/src/a1a2/packages');
  cpSync(join(root, 'vendor/packages'), destination, { recursive: true });
  for (const file of Object.keys(manifest.files).filter(
    (f) => f.startsWith('vendor/packages/') && f.endsWith('.ts')
  )) {
    const relative = file.slice('vendor/packages/'.length);
    const target = join(destination, relative);
    const up = '../'.repeat(relative.split('/').length - 1);
    const source = readFileSync(target, 'utf8')
      .replaceAll('from "contracts"', `from "${up}contracts/src/index.ts"`)
      .replaceAll('from "kernel"', `from "${up}kernel/src/kernel.ts"`);
    writeFileSync(target, source);
  }
  cpSync(
    join(root, 'src/product-session.ts'),
    join(destination, 'editor-bento/src/boot/product-session.ts')
  );
  cpSync(
    join(root, 'src/selection-toolbar.ts'),
    join(destination, 'editor-bento/src/boot/selection-toolbar.ts')
  );
  cpSync(join(root, 'src/image.ts'), join(destination, 'editor-bento/src/ui/dom/image.ts'));
  const imageFile = join(destination, 'editor-bento/src/ui/dom/image.ts');
  writeFileSync(
    imageFile,
    readFileSync(imageFile, 'utf8').replaceAll(
      'from "contracts"',
      'from "../../../../contracts/src/index.ts"'
    )
  );
  const canvasFile = join(destination, 'editor-bento/src/ui/canvas.ts');
  writeFileSync(canvasFile, readFileSync(canvasFile, 'utf8').replace('16000', '4096'));
  // Adapt only the assembled copy. Canonical omitted values and pinned vendor
  // files remain untouched; rendering resolves the product's existing default.
  const defaultsFile = join(destination, 'contracts/src/static-v1.ts');
  const defaults = readFileSync(defaultsFile, 'utf8');
  if (defaults.split('fontFamily: "MiSans",').length !== 2)
    throw Error('Pinned text font default changed; review the Inter adaptation');
  writeFileSync(defaultsFile, defaults.replace('fontFamily: "MiSans",', 'fontFamily: "Inter",'));
  const interactionFile = join(tree, 'slides/src/editor/canvas.ts');
  let interactions = readFileSync(interactionFile, 'utf8');
  for (const selector of [
    '.ed-sidebar, .ed-props, .ed-topbar',
    '.ed-present-fabs, .ed-zoombar, .ed-panel-toggle, .ed-resizer',
  ]) {
    if (!interactions.includes(selector)) throw Error('Pinned canvas UI exclusion changed');
    interactions = interactions.replaceAll(selector, selector + ', [data-molly-toolbar]');
  }
  writeFileSync(interactionFile, interactions);
  const slides = join(tree, 'slides');
  // Use the checked-in npm lockfile; installation may fill an empty CI cache.
  if (process.platform === 'win32')
    run('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], slides);
  else run('npm', ['ci', '--no-audit', '--no-fund'], slides);
  // The local overlay consumes the public command types, without copying their schema.
  mkdirSync(join(slides, 'node_modules/@molly'), { recursive: true });
  symlinkSync(
    resolve(root, '../shared'),
    join(slides, 'node_modules/@molly/shared'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  run(process.execPath, [join(slides, 'node_modules/typescript/bin/tsc'), '-b'], slides);
  run(
    process.execPath,
    [join(slides, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', 'dist-single'],
    slides
  );
  const output = resolve(root, '../../apps/electron/resources/design');
  mkdirSync(output, { recursive: true });
  const html = readFileSync(join(slides, 'dist-single/index.html'), 'utf8');
  if (!html.includes('</head>')) throw Error('Built canvas has no head for font resources');
  const shell = Buffer.from(html.replace('</head>', `<style>${interCss}</style></head>`));
  writeFileSync(join(output, 'editor.html'), shell);
  cpSync(join(root, 'sample.json'), join(output, 'sample.json'));
  cpSync(join(root, 'bento/LICENSE'), join(output, 'BENTO-LICENSE'));
  cpSync(join(root, 'SPACE-MONO-LICENSE'), join(output, 'SPACE-MONO-LICENSE'));
  cpSync(join(root, 'FONTAWESOME-LICENSE'), join(output, 'FONTAWESOME-LICENSE'));
  cpSync(require.resolve('@fontsource/inter/LICENSE'), join(output, 'INTER-LICENSE'));
  writeFileSync(
    join(output, 'build.json'),
    JSON.stringify(
      {
        source: manifest.commit,
        bento: manifest.bentoCommit,
        shellSha256: hash(shell),
        defaultFont: {
          family: 'Inter',
          package: '@fontsource/inter@5.2.8',
          cssSha256: hash(interCss),
        },
        sampleSha256: hash(readFileSync(join(root, 'sample.json'))),
        node: process.version,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`Bento resources built: ${output}`);
} finally {
  try {
    if (registered) run('git', ['worktree', 'remove', '--force', tree], join(root, 'bento'));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
