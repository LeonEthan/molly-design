import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const electronDir = fileURLToPath(new URL('../', import.meta.url))
const localDir = path.join(electronDir, '.sparkle-local')
// Realistic Molly-line versions keep the packaged evidence close to the release
// feed; override only when a throwaway smoke run needs different numbers.
const oldVersion =
  process.env.MOLLY_SPARKLE_OLD_VERSION ?? process.env.LODY_SPARKLE_OLD_VERSION ?? '0.1.0'
const newVersion =
  process.env.MOLLY_SPARKLE_NEW_VERSION ?? process.env.LODY_SPARKLE_NEW_VERSION ?? '0.1.1'
const feedPort = Number(
  process.env.MOLLY_SPARKLE_FEED_PORT ?? process.env.LODY_SPARKLE_FEED_PORT ?? 4371
)
const feedUrl = `http://127.0.0.1:${feedPort}/appcast.xml`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? electronDir,
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(result.status)}): ${result.stderr ?? ''}`
    )
  }
  return result
}

function resolveSparkleBin(name) {
  const require = createRequire(import.meta.url)
  const packageRoot = path.join(path.dirname(require.resolve('electron-sparkle-updater')), '..')
  return path.join(packageRoot, 'native', 'vendor', 'bin', name)
}

function ensureKeys() {
  mkdirSync(localDir, { recursive: true })
  const publicKeyPath = path.join(localDir, 'ed-public-key')
  const privateKeyPath = path.join(localDir, 'ed-private-key')
  if (existsSync(publicKeyPath) && existsSync(privateKeyPath)) {
    return {
      publicEdKey: readFileSync(publicKeyPath, 'utf8').trim(),
      privateKeyPath
    }
  }

  const generateKeys = resolveSparkleBin('generate_keys')
  const account = 'molly-sparkle-local'
  const printed = spawnSync(generateKeys, ['-p', '--account', account], { encoding: 'utf8' })
  if (printed.status !== 0) {
    run(generateKeys, ['--account', account])
  }
  const publicResult = run(generateKeys, ['-p', '--account', account], { stdio: 'pipe' })
  const match = publicResult.stdout.match(/<string>([^<]+)<\/string>/)
  const publicEdKey = match?.[1] ?? publicResult.stdout.trim()
  if (!publicEdKey) {
    throw new Error('Failed to read Sparkle public key from generate_keys -p')
  }
  run(generateKeys, ['--account', account, '-x', privateKeyPath])
  writeFileSync(publicKeyPath, `${publicEdKey}\n`)
  chmodSync(privateKeyPath, 0o600)
  return { publicEdKey, privateKeyPath }
}

function findPackagedApp() {
  const distDir = path.join(electronDir, 'dist')
  // Prefer the standard electron-builder output over any stale fixture layout
  // that may also contain a .app (find order is filesystem-dependent).
  const standard = path.join(distDir, 'mac-arm64', 'Molly.app')
  if (existsSync(standard)) return standard
  const matches = spawnSync('find', [distDir, '-maxdepth', '3', '-name', '*.app', '-type', 'd'], {
    encoding: 'utf8'
  })
  const apps = (matches.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((appPath) => !appPath.includes('/.sparkle-local/'))
  if (apps.length === 0) {
    throw new Error(`No packaged .app found under ${distDir}`)
  }
  return apps[0]
}

function bundleVersion(appPath) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const result = spawnSync(
    'plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plistPath],
    { encoding: 'utf8' }
  )
  return (result.stdout ?? '').trim()
}

function packageVersion(version) {
  // A full electron-builder run per version: Sparkle compares Info.plist while
  // Electron's app.getVersion() reads the asar package.json, and only a real
  // package bumps both. Anything less produces a bundle whose in-app version
  // disagrees with what Sparkle installed.
  run('pnpm', ['run', 'package', '--', '--mac', '--dir'], {
    env: {
      MOLLY_OSS_RELEASE_VERSION: version,
      SPARKLE_ED_PUBLIC_KEY: publicEdKey,
      SPARKLE_APPCAST_URL: feedUrl,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    }
  })
  const packaged = findPackagedApp()
  const actual = bundleVersion(packaged)
  if (actual !== version) {
    throw new Error(`packaged bundle version ${actual} does not match requested ${version}`)
  }
  return packaged
}

function copyApp(fromPath, toPath) {
  mkdirSync(path.dirname(toPath), { recursive: true })
  run('ditto', [fromPath, toPath])
}

function adHocSign(appPath) {
  run('codesign', ['--force', '--sign', '-', appPath])
  run('codesign', ['--verify', '--deep', '--strict', appPath])
}

function setBundleVersion(appPath, version) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  run('plutil', ['-replace', 'CFBundleShortVersionString', '-string', version, plistPath])
  run('plutil', ['-replace', 'CFBundleVersion', '-string', version, plistPath])
}

function startFeedServer(archiveDir) {
  const server = createServer((request, response) => {
    const relativePath = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')
    const filePath = path.join(
      archiveDir,
      relativePath === '/' ? 'appcast.xml' : relativePath.slice(1)
    )
    if (!filePath.startsWith(archiveDir) || !existsSync(filePath)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    const body = readFileSync(filePath)
    const contentType = filePath.endsWith('.xml')
      ? 'application/xml'
      : filePath.endsWith('.zip')
        ? 'application/zip'
        : 'application/octet-stream'
    console.log(
      `[verify-sparkle] ${request.method ?? 'GET'} ${relativePath} -> ${path.basename(filePath)} ${body.length}B`
    )
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length })
    response.end(body)
  })
  return new Promise((resolve) => {
    server.listen(feedPort, '127.0.0.1', () => resolve(server))
  })
}

const skipPackage = process.argv.includes('--skip-package')
const prepareOnly = process.argv.includes('--prepare-only')
const { publicEdKey, privateKeyPath } = ensureKeys()
const workDir = path.join(localDir, 'update-flow')
const archiveDir = path.join(workDir, 'feed')
const oldApp = path.join(workDir, 'old', 'Molly.app')
const newApp = path.join(workDir, 'new', 'Molly.app')
const newZip = path.join(archiveDir, `MollyDesign-${newVersion}-arm64.zip`)

rmSync(workDir, { recursive: true, force: true })
mkdirSync(archiveDir, { recursive: true })

if (skipPackage) {
  // Fast rebuild from the current dist output. Both copies then share one
  // asar version, so this is only for harness smoke iteration, never for an
  // acceptance round: the installed bundle's in-app version would not change.
  const packagedApp = findPackagedApp()
  copyApp(packagedApp, oldApp)
  copyApp(packagedApp, newApp)
  setBundleVersion(newApp, newVersion)
} else {
  run(process.execPath, [path.join(electronDir, 'scripts/build-app.mjs')])
  copyApp(packageVersion(oldVersion), oldApp)
  copyApp(packageVersion(newVersion), newApp)
}
// Prove the post-update bundle really came from the served zip: the marker
// exists only in the "new" app, so finding it after relaunch rules out a
// stale or untouched install.
writeFileSync(
  path.join(newApp, 'Contents', 'Resources', 'update-verification-marker.txt'),
  `Molly ${newVersion} update verification marker\n`
)
adHocSign(newApp)
run('codesign', ['--verify', '--deep', '--strict', oldApp])
run('ditto', ['-c', '-k', '--keepParent', newApp, newZip])

run('pnpm', [
  'exec',
  'electron-sparkle-updater',
  'generate-appcast',
  archiveDir,
  '--ed-key-file',
  privateKeyPath,
  '--download-url-prefix',
  `http://127.0.0.1:${feedPort}/`
])

const appcast = readFileSync(path.join(archiveDir, 'appcast.xml'), 'utf8')
if (!appcast.includes(newVersion) || !appcast.includes('sparkle:edSignature')) {
  throw new Error('Generated appcast is missing the new version or EdDSA signature')
}

writeFileSync(
  path.join(workDir, 'launch.json'),
  `${JSON.stringify({ feedUrl, oldApp, oldBinary: path.join(oldApp, 'Contents', 'MacOS', 'Molly'), newApp, archiveDir, oldVersion, newVersion, publicEdKey }, null, 2)}\n`
)

if (prepareOnly) {
  console.log(`[verify-sparkle] prepared ${feedUrl}`)
  console.log(`[verify-sparkle] old app: ${oldApp}`)
  process.exit(0)
}

const server = await startFeedServer(archiveDir)
const oldBinary = path.join(oldApp, 'Contents', 'MacOS', 'Molly')
if (!existsSync(oldBinary)) {
  throw new Error(`missing packaged binary: ${oldBinary}`)
}

console.log(`[verify-sparkle] serving ${feedUrl}`)
console.log(`[verify-sparkle] launching ${oldVersion} with SPARKLE_APPCAST_URL=${feedUrl}`)
console.log(
  `[verify-sparkle] Sparkle should offer ${newVersion}. Use Check for Updates if the dialog does not appear.`
)

// requireSparkle compares the packaged Info.plist feed against the runtime
// SPARKLE_APPCAST_URL (or the default): without this variable the local-feed
// package disables its own updater as a configuration mismatch.
const child = spawn(oldBinary, [], {
  env: {
    ...process.env,
    MOLLY_ELECTRON_ENABLE_UPDATER: '1',
    SPARKLE_APPCAST_URL: feedUrl
  },
  stdio: 'inherit'
})

const shutdown = () => {
  child.kill('SIGTERM')
  server.close()
}
process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})

child.on('exit', (code) => {
  server.close()
  process.exit(code ?? 0)
})
