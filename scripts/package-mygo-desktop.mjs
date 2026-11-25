#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Experimental MyGo desktop packager. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  buildMollyCore,
  probeMollyCoreComposition,
  verifyMollyCore
} from '../apps/electron/scripts/molly-core-resources.mjs'
import {
  assertEmbeddedSharpPackages,
  sqlitePrebuildFileName
} from '../apps/electron/scripts/cli-native-deps.mjs'
import { verifyLegalResources } from '../apps/electron/scripts/legal-resources.mjs'
import { prepareEmbeddedHarnessSigning } from '../apps/electron/scripts/sign-embedded-harness.mjs'
import { verifyEmbeddedHarness } from '../apps/cli/scripts/verify-embedded-harness.mjs'
import {
  verifyStandaloneCache,
  inspectDarwinExternalDylibs,
  verifyDarwinBinaryArch,
  verifyNodeRuntimeVersion
} from './fetch-standalone-node.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function run(command, args, options = {}) {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    ...options
  })
  if (res.error || res.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${res.error?.message ?? res.stderr ?? res.stdout}`
    )
  }
  return res.stdout.trim()
}

function dirSizeBytes(target) {
  let total = 0
  if (!fs.existsSync(target)) return 0
  const st = fs.lstatSync(target)
  if (st.isFile()) return st.size
  if (!st.isDirectory()) return 0
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += dirSizeBytes(path.join(target, entry.name))
  }
  return total
}

function verifyBentoDesignDir(designDir) {
  const editorPath = path.join(designDir, 'editor.html')
  const buildPath = path.join(designDir, 'build.json')
  const manifest = JSON.parse(fs.readFileSync(buildPath, 'utf8'))
  const actual = sha256(fs.readFileSync(editorPath))
  if (!manifest.shellSha256 || actual !== manifest.shellSha256) {
    throw new Error(`Bento editor.html integrity mismatch in ${designDir}`)
  }
  return manifest
}

export async function packageMyGoDesktop({
  outputDir = path.join(repoRoot, 'dist', 'mygo-experimental'),
  appName = 'Molly Experimental',
  bundleId = 'dev.molly-design.mygo-experimental',
  platform = process.platform,
  arch = process.arch,
  bundleNode = true,
  requireStandaloneNode = false,
  nodeBin = process.env.MOLLY_STANDALONE_NODE_BIN,
  adHocSign = process.platform === 'darwin',
  includeCliResources = true,
  cliResourcesDir = path.join(repoRoot, 'apps', 'electron', 'resources', 'cli')
} = {}) {
  if (platform !== 'darwin') {
    throw new Error(`Experimental MyGo .app packager currently targets darwin only (got ${platform})`)
  }
  const goarch = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null
  if (!goarch) {
    throw new Error(`Unsupported darwin arch: ${arch}`)
  }

  if (requireStandaloneNode && !bundleNode) throw new Error('Standalone Node must be bundled')
  nodeBin ??= requireStandaloneNode ? verifyStandaloneCache(platform, arch) : process.execPath

  const appPath = path.join(outputDir, `${appName}.app`)
  const contentsDir = path.join(appPath, 'Contents')
  const macosDir = path.join(contentsDir, 'MacOS')
  const resourcesDir = path.join(contentsDir, 'Resources')

  fs.rmSync(appPath, { recursive: true, force: true })
  fs.mkdirSync(macosDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })

  const desktopBin = path.join(macosDir, appName)
  run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', desktopBin, './cmd/molly-desktop'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOFLAGS: '-mod=readonly',
      GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'go1.27.3',
      GOOS: 'darwin',
      GOARCH: goarch
    }
  })
  fs.chmodSync(desktopBin, 0o755)

  const mollyCoreDir = path.join(resourcesDir, 'molly-core')
  await buildMollyCore({ platform: 'darwin', arch, outputDir: mollyCoreDir, root: repoRoot })
  verifyMollyCore(mollyCoreDir, { platform: 'darwin', arch })

  const rendererSrc = path.join(repoRoot, 'apps', 'electron', 'out', 'renderer')
  if (!fs.existsSync(path.join(rendererSrc, 'index.html'))) {
    throw new Error(`Missing built renderer at ${rendererSrc}; run apps/electron build first`)
  }
  const rendererDst = path.join(resourcesDir, 'renderer')
  fs.cpSync(rendererSrc, rendererDst, { recursive: true })

  const designSrc = path.join(repoRoot, 'apps', 'electron', 'resources', 'design')
  verifyBentoDesignDir(designSrc)
  const designDst = path.join(resourcesDir, 'design')
  fs.cpSync(designSrc, designDst, { recursive: true })
  verifyBentoDesignDir(designDst)

  const licensesSrc = path.join(repoRoot, 'apps', 'electron', 'resources', 'licenses')
  const licensesDst = path.join(resourcesDir, 'licenses')
  fs.cpSync(licensesSrc, licensesDst, { recursive: true })
  verifyLegalResources(licensesDst)

  const cliDst = path.join(resourcesDir, 'cli')
  let harnessSealed = false
  let cliRuntimeComplete = false
  if (includeCliResources) {
    const cliSrc = cliResourcesDir
    const sqlitePrebuildRel = path.join(
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      sqlitePrebuildFileName({ platform, arch })
    )
    const requiredCliFiles = [
      'index.js',
      'design.js',
      'molly-pi-agent.js',
      path.join('harness', 'runtime-manifest.json'),
      path.join('node_modules', 'better-sqlite3', 'package.json'),
      sqlitePrebuildRel,
      path.join('node_modules', 'loro-crdt', 'package.json'),
      path.join('node_modules', 'loro-crdt', 'nodejs', 'index.js'),
      path.join('node_modules', 'loro-crdt', 'nodejs', 'loro_wasm.js'),
      path.join('node_modules', 'loro-crdt', 'nodejs', 'loro_wasm_bg.wasm'),
      path.join('node_modules', 'tinypool', 'package.json'),
      path.join('node_modules', 'tinypool', 'dist', 'index.js'),
      path.join('node_modules', 'tinypool', 'dist', 'entry', 'worker.js'),
      path.join('node_modules', 'sharp', 'package.json')
    ]
    for (const rel of requiredCliFiles) {
      const candidate = path.join(cliSrc, rel)
      if (!fs.existsSync(candidate)) {
        throw new Error(`Missing required CLI resource for MyGo desktop bundle: ${candidate}`)
      }
    }
    fs.cpSync(cliSrc, cliDst, { recursive: true })
    assertEmbeddedSharpPackages(path.join(cliDst, 'node_modules'), { platform, arch })
    verifyEmbeddedHarness(path.join(cliDst, 'harness'))
    harnessSealed = true
    cliRuntimeComplete = true
  }

  let bundledNodeVersion = null
  let nodeExternalDylibs = []
  let nodeRuntimeSelfContained = false
  if (bundleNode) {
    const resolvedNode = fs.realpathSync(nodeBin)
    bundledNodeVersion = verifyNodeRuntimeVersion(resolvedNode)
    verifyDarwinBinaryArch(resolvedNode, arch)
    nodeExternalDylibs = inspectDarwinExternalDylibs(resolvedNode)
    nodeRuntimeSelfContained = nodeExternalDylibs.length === 0
    if (requireStandaloneNode && !nodeRuntimeSelfContained) {
      throw new Error(
        `Node binary ${resolvedNode} is not self-contained (external dylibs: ${nodeExternalDylibs.join(', ')}); pass an official standalone Node >=22.19 binary via MOLLY_STANDALONE_NODE_BIN`
      )
    }
    const runtimeDir = path.join(resourcesDir, 'runtime')
    fs.mkdirSync(runtimeDir, { recursive: true })
    const nodeDst = path.join(runtimeDir, 'node')
    fs.copyFileSync(resolvedNode, nodeDst)
    fs.chmodSync(nodeDst, 0o755)
  }

  const iconSrc = path.join(repoRoot, 'apps', 'electron', 'build', 'icon.icns')
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(resourcesDir, 'icon.icns'))
  }

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleVersion</key>
  <string>0.2.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist)

  let compositionProbe = null
  if (process.platform === 'darwin' && process.arch === arch) {
    probeMollyCoreComposition(path.join(mollyCoreDir, 'molly-core'))
    compositionProbe = JSON.parse(run(desktopBin, ['--check-local-composition']))
    const caps = compositionProbe?.composition?.capabilities
    if (caps?.localOnly !== true || caps?.telemetryEnabled !== false) {
      throw new Error('molly-desktop local composition check failed')
    }
  }

  const breakdown = {
    appPath,
    platform,
    arch,
    bundleId,
    adHocSigned: adHocSign && process.platform === 'darwin',
    bundledNodeVersion,
    nodeRuntimeSelfContained,
    nodeExternalDylibs,
    harnessSealed,
    cliRuntimeComplete,
    sizesBytes: {
      mollyDesktopBinary: dirSizeBytes(desktopBin),
      mollyCoreDir: dirSizeBytes(mollyCoreDir),
      rendererDir: dirSizeBytes(rendererDst),
      designDir: dirSizeBytes(designDst),
      cliDir: includeCliResources ? dirSizeBytes(cliDst) : 0,
      nodeRuntime: bundleNode ? dirSizeBytes(path.join(resourcesDir, 'runtime', 'node')) : 0,
      totalApp: dirSizeBytes(appPath)
    }
  }
  fs.writeFileSync(
    path.join(resourcesDir, 'bundle-manifest.json'),
    `${JSON.stringify(breakdown, null, 2)}\n`
  )

  if (adHocSign && process.platform === 'darwin') {
    const resealCore = prepareEmbeddedHarnessSigning(mollyCoreDir, verifyMollyCore, 'manifest.json')
    const resealHarness = harnessSealed
      ? prepareEmbeddedHarnessSigning(path.join(cliDst, 'harness'))
      : null

    const signTarget = (targetPath) => {
      run('/usr/bin/codesign', ['--sign', '-', '--force', '--timestamp=none', targetPath])
    }
    signTarget(path.join(mollyCoreDir, 'molly-core'))
    if (bundleNode) {
      signTarget(path.join(resourcesDir, 'runtime', 'node'))
    }
    resealCore()
    if (resealHarness) resealHarness()
    signTarget(desktopBin)
    run('/usr/bin/codesign', ['--sign', '-', '--force', '--timestamp=none', appPath])
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
    verifyMollyCore(mollyCoreDir, { platform: 'darwin', arch })
    if (harnessSealed) {
      verifyEmbeddedHarness(path.join(cliDst, 'harness'))
    }
  }

  breakdown.sizesBytes.totalApp = dirSizeBytes(appPath)
  return breakdown
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const noNode = process.argv.includes('--no-node')
  const noSign = process.argv.includes('--no-sign')
  const requireStandaloneNode = process.argv.includes('--require-standalone-node')
  const outIdx = process.argv.indexOf('--out')
  const outputDir = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : undefined
  const result = await packageMyGoDesktop({
    ...(outputDir ? { outputDir } : {}),
    bundleNode: !noNode,
    requireStandaloneNode,
    adHocSign: !noSign && process.platform === 'darwin'
  })
  console.log(JSON.stringify(result, null, 2))
}
