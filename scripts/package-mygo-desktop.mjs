#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Experimental MyGo desktop packager. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import os from 'node:os'
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

export const developerIdentity = 'Developer ID Application: Leon Ethan (Q96C8424X6)'

export function inspectDeveloperSignature(target, identity) {
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', target], {
    encoding: 'utf8'
  })
  return verifyDeveloperSignatureDetails(result, target, identity)
}

export function verifyDeveloperSignatureDetails(result, target, identity) {
  const details = result.stderr ?? ''
  const teamIdentifier = /^TeamIdentifier=([A-Z0-9]+)$/m.exec(details)?.[1]
  if (
    result.status !== 0 ||
    !teamIdentifier ||
    !details.includes(`Authority=${identity}\n`) ||
    !identity.endsWith(`(${teamIdentifier})`) ||
    !/flags=.*\([^)]*\bruntime\b/.test(details)
  ) {
    throw new Error(`Invalid Developer ID signature for ${target}: ${details}`)
  }
  return { teamIdentifier, hardenedRuntime: true }
}

function signMachOFiles(directory, sign) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) signMachOFiles(file, sign)
    if (!entry.isFile()) continue
    const fd = fs.openSync(file, 'r')
    const magic = Buffer.alloc(4)
    try {
      fs.readSync(fd, magic, 0, 4, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (
      /^(feedface|cefaedfe|feedfacf|cffaedfe|cafebabe|bebafeca|cafebabf|bfbafeca)$/.test(
        magic.toString('hex')
      )
    )
      sign(file)
  }
}

export function signingOptions(args, env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      'developer-id': { type: 'boolean' },
      'sign-identity': { type: 'string' },
      'ad-hoc': { type: 'boolean' },
      'no-sign': { type: 'boolean' },
      notarize: { type: 'boolean' },
      'notary-profile': { type: 'string' },
      'notary-key': { type: 'string' },
      'notary-key-id': { type: 'string' },
      'notary-issuer': { type: 'string' },
      'sparkle-feed-url': { type: 'string' },
      'sparkle-public-key': { type: 'string' },
      'sparkle-framework': { type: 'string' },
      'bundle-sparkle': { type: 'boolean' },
      version: { type: 'string' },
      out: { type: 'string' },
      'no-node': { type: 'boolean' },
      'require-standalone-node': { type: 'boolean' }
    }
  })
  if (
    [values['developer-id'] || values['sign-identity'], values['no-sign'], values['ad-hoc']].filter(
      Boolean
    ).length > 1
  )
    throw new Error('Conflicting signing modes')
  const signIdentity =
    values['no-sign'] || values['ad-hoc']
      ? undefined
      : (values['sign-identity'] ??
        env.MOLLY_MACOS_SIGN_IDENTITY ??
        (values['developer-id'] ? developerIdentity : undefined))
  if (signIdentity && !/^Developer ID Application: .+ \([A-Z0-9]+\)$/.test(signIdentity))
    throw new Error('Expected a Developer ID Application identity')
  let notaryArgs
  if (values.notarize) {
    if (!signIdentity) throw new Error('Notarization requires Developer ID signing')
    if (values['notary-profile']) notaryArgs = ['--keychain-profile', values['notary-profile']]
    else {
      const key = values['notary-key'] ?? env.APPLE_API_KEY
      const id = values['notary-key-id'] ?? env.APPLE_API_KEY_ID
      const issuer = values['notary-issuer'] ?? env.APPLE_API_ISSUER
      if (key && id && issuer) notaryArgs = ['--key', key, '--key-id', id, '--issuer', issuer]
    }
    if (!notaryArgs)
      throw new Error(
        'Missing notarization credentials: provide --notary-profile or Apple API key credentials'
      )
  }
  return {
    signIdentity,
    notaryArgs,
    adHocSign: !signIdentity && !values['no-sign'],
    sparkleFeedUrl: values['sparkle-feed-url'],
    sparklePublicKey: values['sparkle-public-key'],
    sparkleFrameworkPath: values['sparkle-framework'],
    bundleSparkle: values['bundle-sparkle'],
    version: values.version,
    outputDir: values.out,
    bundleNode: !values['no-node'],
    requireStandaloneNode: values['require-standalone-node']
  }
}

export function renderInfoPlist({
  appName,
  bundleId,
  version = '0.2.0',
  sparkleFeedUrl,
  sparklePublicKey
}) {
  const escape = (value) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const metadata = [
    ['SUFeedURL', sparkleFeedUrl],
    ['SUPublicEDKey', sparklePublicKey]
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `  <key>${key}</key>\n  <string>${escape(value)}</string>\n`)
    .join('')
  const sparklePolicy =
    sparkleFeedUrl || sparklePublicKey
      ? `  <key>SUEnableInstallerLauncherService</key>\n  <false/>\n  <key>SUScheduledCheckInterval</key>\n  <integer>3600</integer>\n`
      : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${escape(appName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escape(appName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escape(bundleId)}</string>
  <key>CFBundleVersion</key>
  <string>${escape(version)}</string>
  <key>CFBundleShortVersionString</key>
  <string>${escape(version)}</string>
  <key>CFBundleExecutable</key>
  <string>${escape(appName)}</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
${metadata}${sparklePolicy}</dict>
</plist>
`
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
  version = '0.2.0',
  platform = process.platform,
  arch = process.arch,
  bundleNode = true,
  requireStandaloneNode = false,
  nodeBin = process.env.MOLLY_STANDALONE_NODE_BIN,
  adHocSign = process.platform === 'darwin',
  signIdentity,
  notaryArgs,
  sparkleFeedUrl,
  sparklePublicKey,
  bundleSparkle = Boolean(sparkleFeedUrl || sparklePublicKey),
  sparkleFrameworkPath = path.join(
    repoRoot,
    'apps',
    'electron',
    'node_modules',
    'electron-sparkle-updater',
    'native',
    'vendor',
    'Sparkle.framework'
  ),
  includeCliResources = true,
  cliResourcesDir = path.join(repoRoot, 'apps', 'electron', 'resources', 'cli')
} = {}) {
  if (notaryArgs && (!signIdentity || process.platform !== 'darwin'))
    throw new Error('Notarization requires Developer ID signing on macOS')
  if (platform !== 'darwin') {
    throw new Error(
      `Experimental MyGo .app packager currently targets darwin only (got ${platform})`
    )
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
  run(
    'go',
    [
      'build',
      '-trimpath',
      `-ldflags=-s -w -X main.desktopVersion=${version}`,
      '-o',
      desktopBin,
      './cmd/molly-desktop'
    ],
    {
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

  let sparkleEmbedded = false
  const frameworksDir = path.join(contentsDir, 'Frameworks')
  const sparkleDst = path.join(frameworksDir, 'Sparkle.framework')
  if (bundleSparkle) {
    if (!fs.existsSync(path.join(sparkleFrameworkPath, 'Versions', 'B', 'Sparkle'))) {
      throw new Error(`Missing Sparkle.framework at ${sparkleFrameworkPath}`)
    }
    fs.mkdirSync(frameworksDir, { recursive: true })
    run('/usr/bin/ditto', [sparkleFrameworkPath, sparkleDst])
    sparkleEmbedded = true
  }

  const infoPlist = renderInfoPlist({
    appName,
    bundleId,
    version,
    sparkleFeedUrl,
    sparklePublicKey
  })
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
    version,
    signingMode: signIdentity ? 'developer-id' : adHocSign ? 'ad-hoc' : 'unsigned',
    teamIdentifier: null,
    hardenedRuntime: false,
    adHocSigned: !signIdentity && adHocSign && process.platform === 'darwin',
    sparkleEmbedded,
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
      sparkleFramework: sparkleEmbedded ? dirSizeBytes(sparkleDst) : 0,
      totalApp: dirSizeBytes(appPath)
    }
  }
  fs.writeFileSync(
    path.join(resourcesDir, 'bundle-manifest.json'),
    `${JSON.stringify(breakdown, null, 2)}\n`
  )

  if ((adHocSign || signIdentity) && process.platform === 'darwin') {
    const resealCore = prepareEmbeddedHarnessSigning(mollyCoreDir, verifyMollyCore, 'manifest.json')
    const resealHarness = harnessSealed
      ? prepareEmbeddedHarnessSigning(path.join(cliDst, 'harness'))
      : null

    const signTarget = (targetPath) => {
      run('/usr/bin/codesign', [
        '--sign',
        signIdentity ?? '-',
        '--force',
        ...(signIdentity
          ? [
              '--options',
              'runtime',
              '--timestamp',
              '--entitlements',
              path.join(repoRoot, 'apps/electron/build/entitlements.mac.plist')
            ]
          : ['--timestamp=none']),
        targetPath
      ])
    }
    if (signIdentity && includeCliResources) signMachOFiles(cliDst, signTarget)
    if (sparkleEmbedded) {
      const sparkleVersionDir = path.join(sparkleDst, 'Versions', 'B')
      for (const nested of [
        path.join(sparkleVersionDir, 'XPCServices', 'Installer.xpc'),
        path.join(sparkleVersionDir, 'XPCServices', 'Downloader.xpc'),
        path.join(sparkleVersionDir, 'Autoupdate'),
        path.join(sparkleVersionDir, 'Updater.app'),
        sparkleDst
      ]) {
        if (fs.existsSync(nested)) signTarget(nested)
      }
    }
    signTarget(path.join(mollyCoreDir, 'molly-core'))
    if (bundleNode) {
      signTarget(path.join(resourcesDir, 'runtime', 'node'))
    }
    resealCore()
    if (resealHarness) resealHarness()
    signTarget(desktopBin)
    if (signIdentity) {
      Object.assign(breakdown, inspectDeveloperSignature(desktopBin, signIdentity))
      fs.writeFileSync(
        path.join(resourcesDir, 'bundle-manifest.json'),
        JSON.stringify(breakdown, null, 2) + '\n'
      )
    }
    signTarget(appPath)
    if (signIdentity) inspectDeveloperSignature(appPath, signIdentity)
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
    verifyMollyCore(mollyCoreDir, { platform: 'darwin', arch })
    if (harnessSealed) {
      verifyEmbeddedHarness(path.join(cliDst, 'harness'))
    }
  }

  if (notaryArgs) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mygo-notary-'))
    try {
      const zip = path.join(temp, 'application.zip')
      run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, zip])
      const receipt = JSON.parse(
        run('/usr/bin/xcrun', [
          'notarytool',
          'submit',
          zip,
          ...notaryArgs,
          '--wait',
          '--output-format',
          'json'
        ])
      )
      if (receipt.status !== 'Accepted') throw new Error(`Notarization status: ${receipt.status}`)
      run('/usr/bin/xcrun', ['stapler', 'staple', appPath])
      run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
      run('/usr/bin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
      breakdown.notarization = { id: receipt.id, status: receipt.status, gatekeeperAccepted: true }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  }
  breakdown.sizesBytes.totalApp = dirSizeBytes(appPath)
  return breakdown
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log = console.error
  const report = await packageMyGoDesktop(signingOptions(process.argv.slice(2)))
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}
