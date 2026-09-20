import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Execute the staged decoder using the actual embedded runtime, without repo resolution. */
export function probeImageDecoder(cliDirectory, runtime = process.execPath) {
  // Node resolves dependencies to real paths (notably /tmp -> /private/tmp on
  // macOS). Compare within that same namespace without relaxing containment.
  cliDirectory = realpathSync(cliDirectory)
  const source = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(${JSON.stringify(path.join(path.resolve(cliDirectory), 'index.js'))});
const prefix = ${JSON.stringify(path.resolve(cliDirectory) + path.sep)};
for (const name of ['sharp', 'semver', 'detect-libc', '@img/colour']) {
  if (!require.resolve(name).startsWith(prefix)) throw new Error('decoder escaped staged resources: ' + name);
}
const { default: sharp } = await import(pathToFileURL(require.resolve('sharp')).href);
for (const format of ['png', 'jpeg', 'gif', 'webp']) {
  const bytes = await sharp({create:{width:2,height:3,channels:4,background:{r:32,g:64,b:128,alpha:1}}}).toFormat(format).toBuffer();
  const { info } = await sharp(bytes,{failOn:'warning',limitInputPixels:64_000_000,pages:-1}).raw().toBuffer({resolveWithObject:true});
  if (info.width !== 2 || info.height !== 3) throw new Error('decoder dimensions mismatch');
}
const corrupt = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let refused = false;
try { await sharp(corrupt,{failOn:'warning'}).raw().toBuffer(); } catch { refused = true; }
if (!refused) throw new Error('corrupt pixels accepted');
console.log(JSON.stringify({kind:'image-decoder-ok',version:sharp.versions.sharp,platform:process.platform,arch:process.arch}));
`
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'LANG', 'SystemRoot', 'WINDIR'].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]]
    )
  )
  const result = spawnSync(path.resolve(runtime), ['--input-type=module', '--eval', source], {
    cwd: cliDirectory,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  })
  if (result.error || result.status !== 0 || !result.stdout.includes('image-decoder-ok'))
    throw new Error(
      `Embedded image decoder probe failed: ${result.error?.message ?? result.stderr}`
    )
  console.log(result.stdout.trim())
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: image-decoder-probe.mjs <staged-cli-dir> [runtime]')
  probeImageDecoder(path.resolve(process.argv[2]), process.argv[3])
}
