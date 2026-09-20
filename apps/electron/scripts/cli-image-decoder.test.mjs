import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { sharpTargetPackages, assertEmbeddedSharpPackages } from './cli-native-deps.mjs'
import { probeImageDecoder } from './image-decoder-probe.mjs'

// Exercise the actual child-process containment gate, not image decoding. Loading
// this synthetic module is an explicit signal that all path checks completed.
async function decoderPathFixture(root) {
  const cli = path.join(root, 'cli')
  for (const name of ['sharp', 'semver', 'detect-libc', '@img/colour']) {
    const directory = path.join(cli, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'index.js'),
      name === 'sharp' ? 'throw new Error("synthetic-decoder-reached")' : 'module.exports = {}'
    )
  }
  return cli
}

test('decoder containment accepts an aliased staging root without repository fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'molly-decoder-alias-test-'))
  try {
    const cli = await decoderPathFixture(root)
    const alias = path.join(root, 'alias')
    await symlink(cli, alias, 'junction')
    assert.throws(() => probeImageDecoder(alias), /synthetic-decoder-reached/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('decoder containment still rejects a dependency symlink outside staging', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'molly-decoder-escape-test-'))
  try {
    const cli = await decoderPathFixture(root)
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'index.js'), 'throw new Error("outside-decoder-loaded")')
    const sharp = path.join(cli, 'node_modules', 'sharp')
    await rm(sharp, { recursive: true })
    await symlink(outside, sharp, 'junction')
    assert.throws(() => probeImageDecoder(cli), /decoder escaped staged resources: sharp/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('decoder resource targets select the addon and only the required shared libraries', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      assert.deepEqual(sharpTargetPackages({ platform, arch }), [
        `@img/sharp-${platform}-${arch}`,
        ...(platform === 'win32' ? [] : [`@img/sharp-libvips-${platform}-${arch}`])
      ])
    }
  }
  assert.throws(() => sharpTargetPackages({ platform: 'darwin', arch: 'universal' }))
  assert.throws(() => sharpTargetPackages({ platform: 'unknown', arch: 'arm64' }))
})

test('packaged image decoder rejects missing resources and mismatched versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'molly-decoder-resource-test-'))
  const target = { platform: 'win32', arch: 'x64' }
  const name = '@img/sharp-win32-x64'
  try {
    await mkdir(path.join(root, 'sharp'), { recursive: true })
    await writeFile(
      path.join(root, 'sharp/package.json'),
      JSON.stringify({ optionalDependencies: { [name]: '0.35.4' } })
    )
    assert.throws(() => assertEmbeddedSharpPackages(root, target))
    const directory = path.join(root, name)
    await mkdir(path.join(directory, 'lib'), { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, version: '0.35.4' })
    )
    assert.throws(() => assertEmbeddedSharpPackages(root, target), /binary missing/)
    await writeFile(
      path.join(directory, 'lib/sharp-win32-x64.node'),
      'synthetic resource presence, not native load evidence'
    )
    assert.doesNotThrow(() => assertEmbeddedSharpPackages(root, target))
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name, version: '0.35.3' })
    )
    assert.throws(() => assertEmbeddedSharpPackages(root, target), /Mismatched/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
