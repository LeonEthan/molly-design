import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { ModelConnectionStore } from './model-connection-store.ts'
import { probeProtectedImageConnection } from './image-connection-probe.ts'
import { readBundledCapabilities } from './bundled-capabilities.ts'

for (const mode of [
  'valid',
  'missing',
  'corrupt',
  'duplicate',
  'platform',
  'commands',
  'license'
]) {
  void test(`bundled capability inventory verifies fixed public resources: ${mode}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'molly-capabilities-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const resources = join(root, 'harness', 'extensions', 'pi-ask-question')
    await mkdir(resources, { recursive: true })
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    const license = 'Synthetic license fixture'
    const extension = JSON.stringify({
      schemaVersion: 1,
      name: 'pi-ask-question',
      version: '0.4.0',
      commit: 'a'.repeat(40),
      license: 'MIT',
      licenseSha256: mode === 'license' ? '0'.repeat(64) : hash(license),
      selectedTools: ['ask_question'],
      selectedCommands: mode === 'commands' ? ['unmapped'] : [],
      extraPrivateField: 'synthetic-not-for-renderer'
    })
    const files = [
      { path: 'extensions/pi-ask-question/manifest.json', sha256: hash(extension) },
      { path: 'extensions/pi-ask-question/LICENSE', sha256: hash(license) }
    ]
    if (mode === 'duplicate') files.push(files[0])
    const runtime = {
      engine: 'pi',
      engineVersion: '0.85.1',
      protocolVersion: 1,
      buildId: 'b'.repeat(64),
      buildPlatform: mode === 'platform' ? 'other' : process.platform,
      buildArch: process.arch,
      files
    }
    await writeFile(join(root, 'harness', 'runtime-manifest.json'), JSON.stringify(runtime))
    if (mode !== 'missing')
      await writeFile(join(resources, 'manifest.json'), mode === 'corrupt' ? '{}' : extension)
    await writeFile(join(resources, 'LICENSE'), license)
    const result = readBundledCapabilities(join(root, 'index.js'))
    if (mode !== 'valid') {
      await assert.rejects(result, { message: 'bundled_capabilities_unavailable' })
      return
    }
    const snapshot = await result
    assert.equal(snapshot.harness.buildId, runtime.buildId)
    assert.deepEqual(snapshot.extensions, [
      {
        name: 'pi-ask-question',
        version: '0.4.0',
        commit: 'a'.repeat(40),
        license: 'MIT',
        tools: ['ask_question'],
        activation: 'requires-question-ui-v1'
      }
    ])
    assert.equal(JSON.stringify(snapshot).includes('synthetic-not-for-renderer'), false)
    assert.equal(JSON.stringify(snapshot).includes(root), false)
    await assert.rejects(readBundledCapabilities(null), {
      message: 'bundled_capabilities_unavailable'
    })
  })
}

// Deterministic synthetic cipher, not a substitute for OS-keychain acceptance.
const key = Buffer.alloc(32, 7)
const iv = Buffer.alloc(16, 3)
const cipher = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString(value) {
    const instance = createCipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([instance.update(value, 'utf8'), instance.final()])
  },
  decryptString(value) {
    const instance = createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([instance.update(value), instance.final()]).toString('utf8')
  }
}
const input = {
  displayName: 'Synthetic',
  providerPresetId: 'openai',
  baseUrl: 'https://example.invalid/v1',
  enabled: true,
  apiKey: 'synthetic-secret-not-for-production'
}
const legacyImage = {
  v: 1,
  enabled: true,
  baseUrl: 'https://images.invalid/v1',
  model: 'synthetic-image',
  apiKey: 'synthetic-image-secret',
  updatedAt: 1
}

void test('compatible model metadata persists with revision CAS and no public credential', async (t) => {
  const { directory, store } = await fixture(t)
  const customModels = [
    {
      modelId: 'vendor/custom',
      name: 'Custom',
      input: ['text', 'image'],
      contextWindow: 32768,
      maxTokens: 4096,
      thinking: ['off', 'high'],
      toolCalls: true,
      usageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  ]
  const saved = await store.save({ ...input, providerPresetId: 'openai-compatible', customModels })
  const reopened = new ModelConnectionStore(directory, cipher)
  const acquired = await reopened.acquireForRun(saved.id, saved.revision)
  assert.deepEqual(acquired.connection.customModels, customModels)
  assert.equal(acquired.apiKey, input.apiKey)
  assert.equal(JSON.stringify(saved).includes(input.apiKey), false)
  assert.equal(
    (await readFile(join(directory, 'model-connections.enc'))).includes(
      Buffer.from('vendor/custom')
    ),
    false
  )
  const updated = await reopened.save({
    ...input,
    apiKey: undefined,
    providerPresetId: 'openai-compatible',
    id: saved.id,
    expectedRevision: saved.revision,
    customModels: customModels.map((model) => ({ ...model, maxTokens: 2048 }))
  })
  assert.equal(updated.revision, saved.revision + 1)
  assert.equal(updated.customModels[0].maxTokens, 2048)
  await assert.rejects(reopened.acquireForRun(saved.id, saved.revision), {
    message: 'model_connection_unavailable'
  })
  await assert.rejects(
    reopened.save({
      ...input,
      id: saved.id,
      expectedRevision: saved.revision,
      providerPresetId: 'openai-compatible',
      customModels
    }),
    { message: 'model_connection_revision_conflict' }
  )
})

void test('image migration encrypts before acknowledgement and never exposes the key through public metadata', async (t) => {
  const { directory, store } = await fixture(t)
  await store.importLegacyImage(legacyImage)
  const first = await store.imageSnapshot()
  await store.importLegacyImage(legacyImage)
  assert.deepEqual(await store.imageSnapshot(), first)
  assert.equal(first.connection.legacyHistoryMayContainKey, true)
  assert.equal(JSON.stringify(first).includes(legacyImage.apiKey), false)
  assert.equal(
    (await readFile(join(directory, 'model-connections.enc'))).includes(
      Buffer.from(legacyImage.apiKey)
    ),
    false
  )
  const reopened = new ModelConnectionStore(directory, cipher)
  assert.equal(
    (await reopened.acquireImageForRun(first.connection.id, first.connection.revision)).apiKey,
    legacyImage.apiKey
  )
})

void test('protected image edits use revision CAS and require renewed destination consent', async (t) => {
  const { store } = await fixture(t)
  await store.importLegacyImage(legacyImage)
  const draft = {
    enabled: true,
    baseUrl: legacyImage.baseUrl,
    model: legacyImage.model,
    clearApiKey: false,
    expectedRevision: 1
  }
  await assert.rejects(
    store.saveImage({ ...draft, baseUrl: 'https://other.invalid/v1' }),
    /destination_requires_credential/
  )
  const changed = await store.saveImage({
    ...draft,
    baseUrl: 'https://other.invalid/v1',
    apiKey: 'synthetic-new'
  })
  await assert.rejects(store.saveImage(draft), /revision_conflict/)
  await assert.rejects(store.acquireImageForRun(changed.id, 1), /unavailable/)
  await store.importLegacyImage({ ...legacyImage, updatedAt: 2 })
  assert.equal(
    (await store.acquireImageForRun(changed.id, changed.revision)).apiKey,
    'synthetic-new'
  )
  await store.saveImage({
    ...draft,
    baseUrl: changed.baseUrl,
    expectedRevision: changed.revision,
    clearApiKey: true
  })
  await assert.rejects(store.acquireImageForRun(changed.id, changed.revision + 1), /unavailable/)
})

void test('a migration encryption failure leaves the prior vault unchanged', async (t) => {
  const { directory, store } = await fixture(t)
  await store.save(input)
  const previous = await readFile(join(directory, 'model-connections.enc'))
  const broken = new ModelConnectionStore(directory, {
    ...cipher,
    encryptString() {
      throw Error('synthetic failure')
    }
  })
  await assert.rejects(broken.importLegacyImage(legacyImage), /credential_storage_write_failed/)
  assert.deepEqual(await readFile(join(directory, 'model-connections.enc')), previous)
})

void test('image discovery is explicit, destination-bound and does not expose upstream diagnostics', async (t) => {
  const { store } = await fixture(t)
  await store.importLegacyImage(legacyImage)
  const requests = []
  const result = await probeProtectedImageConnection(store, 1, async (url, options) => {
    requests.push({ url, redirect: options.redirect, authorization: options.headers.authorization })
    return new Response(JSON.stringify({ data: [{ id: 'synthetic' }] }))
  })
  assert.deepEqual(result, { ok: true, modelCount: 1 })
  assert.deepEqual(requests, [
    {
      url: 'https://images.invalid/v1/models',
      redirect: 'error',
      authorization: `Bearer ${legacyImage.apiKey}`
    }
  ])
  assert.deepEqual(
    await probeProtectedImageConnection(
      store,
      1,
      async () => new Response(legacyImage.apiKey, { status: 401 })
    ),
    { ok: false, error: 'image_connection_http_401' }
  )
})
async function fixture(t, customCipher = cipher, platform = 'darwin') {
  const directory = await mkdtemp(join(tmpdir(), 'molly-vault-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, store: new ModelConnectionStore(directory, customCipher, platform) }
}

void test('persists only ciphertext, returns only public metadata, and reopens across process lifetimes', async (t) => {
  const { directory, store } = await fixture(t)
  const saved = await store.save(input)
  assert.equal(saved.revision, 1)
  assert.equal('apiKey' in saved, false)
  const bytes = await readFile(join(directory, 'model-connections.enc'))
  assert.equal(bytes.includes(Buffer.from(input.apiKey)), false)
  assert.equal((await stat(join(directory, 'model-connections.enc'))).mode & 0o777, 0o600)
  const reopened = new ModelConnectionStore(directory, cipher)
  assert.deepEqual(await reopened.snapshot(), { connections: [saved] })
  assert.equal((await reopened.acquireForRun(saved.id, 1)).apiKey, input.apiKey)
})

void test('serializes competing edits with revision checks and keeps the saved key out of snapshots', async (t) => {
  const { store } = await fixture(t)
  const saved = await store.save(input)
  const update = { ...input, id: saved.id, expectedRevision: 1, displayName: 'Updated' }
  delete update.apiKey
  const results = await Promise.allSettled([store.save(update), store.save(update)])
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected']
  )
  assert.equal((await store.snapshot()).connections[0].revision, 2)
  await assert.rejects(store.acquireForRun(saved.id, 1), /model_connection_unavailable/)
  assert.equal((await store.acquireForRun(saved.id, 2)).apiKey, input.apiKey)
})

void test('requires renewed credentials for a changed destination and rejects arbitrary credential references', async (t) => {
  const { store } = await fixture(t)
  const saved = await store.save(input)
  const { apiKey, ...withoutSecret } = input
  await assert.rejects(
    store.save({
      ...withoutSecret,
      id: saved.id,
      expectedRevision: 1,
      baseUrl: 'https://other.invalid/v1'
    }),
    /destination_requires_credential/
  )
  await assert.rejects(
    store.save({ ...input, credentialRef: 'someone-else' }),
    /invalid_model_connection/
  )
  assert.equal((await store.acquireForRun(saved.id, 1)).apiKey, apiKey)
})

void test('deletion and disabling invalidate future acquisition without reading a secret into IPC', async (t) => {
  const { store } = await fixture(t)
  const saved = await store.save(input)
  await store.save({ ...input, id: saved.id, expectedRevision: 1, enabled: false })
  await assert.rejects(store.acquireForRun(saved.id, 2), /model_connection_unavailable/)
  await assert.rejects(store.delete({ id: saved.id, expectedRevision: 1 }), /revision_conflict/)
  await store.delete({ id: saved.id, expectedRevision: 2 })
  assert.deepEqual(await store.snapshot(), { connections: [] })
})

void test('unavailable keychains and Linux plaintext fallback fail closed', async (t) => {
  const unavailable = await fixture(t, { ...cipher, isEncryptionAvailable: () => false })
  await assert.rejects(unavailable.store.save(input), /credential_storage_unavailable/)
  const insecure = await fixture(
    t,
    { ...cipher, getSelectedStorageBackend: () => 'basic_text' },
    'linux'
  )
  await assert.rejects(insecure.store.snapshot(), /credential_storage_unavailable/)
})

void test('corruption is preserved and schema/decryption input never appears in errors', async (t) => {
  const { directory, store } = await fixture(t)
  await store.save(input)
  const corrupted = Buffer.from('synthetic-invalid-vault')
  await writeFile(join(directory, 'model-connections.enc'), corrupted)
  await assert.rejects(store.save(input), { message: 'credential_storage_unreadable' })
  assert.deepEqual(await readFile(join(directory, 'model-connections.enc')), corrupted)
})

void test('failed encryption preserves the last committed connection', async (t) => {
  let fail = false
  const { directory, store } = await fixture(t, {
    ...cipher,
    encryptString(value) {
      if (fail) throw new Error(`must-not-leak:${value}`)
      return cipher.encryptString(value)
    }
  })
  const saved = await store.save(input)
  const previous = await readFile(join(directory, 'model-connections.enc'))
  fail = true
  await assert.rejects(store.save({ ...input, id: saved.id, expectedRevision: 1 }), {
    message: 'credential_storage_write_failed'
  })
  assert.deepEqual(await readFile(join(directory, 'model-connections.enc')), previous)
})

const mcpInput = {
  workspaceId: 'synthetic-workspace',
  serverId: 'synthetic-server-a',
  destination: { transport: 'http', url: 'https://mcp-a.invalid/mcp' },
  values: { Authorization: 'Bearer synthetic-mcp-a-secret' }
}

void test('MCP credentials remain encrypted and are acquired only for the exact owner and destination', async (t) => {
  const { directory, store } = await fixture(t)
  const saved = await store.saveMcp(mcpInput)
  const other = await store.saveMcp({
    ...mcpInput,
    serverId: 'synthetic-server-b',
    destination: { transport: 'stdio', command: '/synthetic/mcp', args: ['--stdio'] },
    values: { SERVICE_TOKEN: 'synthetic-mcp-b-secret' }
  })
  assert.deepEqual(saved.fieldNames, ['Authorization'])
  assert.equal(saved.revision, 1)
  assert.equal(JSON.stringify(await store.mcpSnapshot()).includes('synthetic-mcp-a-secret'), false)
  const bytes = await readFile(join(directory, 'model-connections.enc'))
  assert.equal(bytes.includes(Buffer.from('synthetic-mcp-a-secret')), false)
  assert.equal(bytes.includes(Buffer.from('synthetic-mcp-b-secret')), false)
  const reopened = new ModelConnectionStore(directory, cipher)
  assert.deepEqual((await reopened.acquireMcpForRun(saved)).values, mcpInput.values)
  assert.deepEqual((await reopened.acquireMcpForRun(other)).values, {
    SERVICE_TOKEN: 'synthetic-mcp-b-secret'
  })
  for (const substituted of [
    { ...saved, workspaceId: 'another-workspace' },
    { ...saved, serverId: other.serverId },
    { ...saved, credentialRef: other.credentialRef },
    { ...saved, revision: 2 },
    { ...saved, destination: { transport: 'http', url: 'https://mcp-b.invalid/mcp' } },
    { ...saved, fieldNames: ['Other-Header'] }
  ]) {
    await assert.rejects(reopened.acquireMcpForRun(substituted), /mcp_credential_unavailable/)
  }
})

void test('MCP rotation is serialized, revision-bound, and requires renewed destination input', async (t) => {
  const { store } = await fixture(t)
  const saved = await store.saveMcp(mcpInput)
  const { values, ...publicInput } = mcpInput
  await assert.rejects(store.saveMcp(publicInput), /revision_conflict/)
  await assert.rejects(
    store.saveMcp({
      ...publicInput,
      expectedRevision: 1,
      destination: { transport: 'http', url: 'https://mcp-b.invalid/mcp' }
    }),
    /destination_requires_credential/
  )
  const results = await Promise.allSettled([
    store.saveMcp({ ...publicInput, expectedRevision: 1 }),
    store.saveMcp({ ...publicInput, expectedRevision: 1 })
  ])
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected']
  )
  assert.equal(results[0].status, 'fulfilled')
  const updated = results[0].value
  assert.equal(updated.credentialRef, saved.credentialRef)
  assert.equal(updated.revision, 2)
  await assert.rejects(store.acquireMcpForRun(saved), /unavailable/)
  assert.deepEqual((await store.acquireMcpForRun(updated)).values, values)
  const rotated = await store.saveMcp({
    ...publicInput,
    expectedRevision: 2,
    destination: { transport: 'http', url: 'https://mcp-b.invalid/mcp' },
    values: { 'X-Api-Key': 'synthetic-rotated' }
  })
  assert.deepEqual((await store.acquireMcpForRun(rotated)).values, {
    'X-Api-Key': 'synthetic-rotated'
  })
  await assert.rejects(store.acquireMcpForRun(updated), /unavailable/)
  await assert.rejects(
    store.deleteMcp({ ...publicInput, expectedRevision: 3 }),
    /invalid_mcp_credential/
  )
  await assert.rejects(
    store.deleteMcp({
      workspaceId: saved.workspaceId,
      serverId: saved.serverId,
      expectedRevision: 2
    }),
    /revision_conflict/
  )
  await store.deleteMcp({
    workspaceId: saved.workspaceId,
    serverId: saved.serverId,
    expectedRevision: 3
  })
  assert.deepEqual(await store.mcpSnapshot(), { connections: [] })
  await assert.rejects(store.acquireMcpForRun(rotated), /unavailable/)
})

void test('MCP rejects unbounded, injected and process-control fields without echoing credentials', async (t) => {
  const { store } = await fixture(t)
  const invalidInputs = [
    { ...mcpInput, credentialRef: 'caller-selected' },
    { ...mcpInput, values: {} },
    { ...mcpInput, values: { Authorization: 'secret\r\nInjected: value' } },
    { ...mcpInput, values: { Authorization: 'first', authorization: 'second' } },
    { ...mcpInput, values: { 'Content-Length': '1' } },
    { ...mcpInput, values: { 'Mcp-Session-Id': 'other-session' } },
    { ...mcpInput, values: { Token: 'x'.repeat(16_385) } },
    {
      ...mcpInput,
      values: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`Key${i}`, 'x']))
    },
    { ...mcpInput, destination: { transport: 'http', url: 'http://remote.invalid/mcp' } },
    { ...mcpInput, destination: { transport: 'http', url: 'https://mcp.invalid/?key=secret' } },
    ...[
      'NODE_OPTIONS',
      'PATH',
      'HOME',
      'LD_PRELOAD',
      'DYLD_INSERT_LIBRARIES',
      'BASH_ENV',
      'PI_OFFLINE',
      'HTTP_PROXY',
      'no_proxy'
    ].map((name) => ({
      ...mcpInput,
      destination: { transport: 'stdio', command: '/synthetic/mcp', args: [] },
      values: { [name]: 'synthetic-credential' }
    }))
  ]
  for (const invalid of invalidInputs) {
    await assert.rejects(store.saveMcp(invalid), { message: 'invalid_mcp_credential' })
  }
  assert.deepEqual(await store.mcpSnapshot(), { connections: [] })
})

void test('MCP writes fail closed on unavailable protection and preserve all previous credentials on failure', async (t) => {
  const unavailable = await fixture(t, { ...cipher, isEncryptionAvailable: () => false })
  await assert.rejects(unavailable.store.saveMcp(mcpInput), /credential_storage_unavailable/)
  const { directory, store } = await fixture(t)
  const model = await store.save(input)
  const saved = await store.saveMcp(mcpInput)
  const previous = await readFile(join(directory, 'model-connections.enc'))
  const failing = new ModelConnectionStore(directory, {
    ...cipher,
    encryptString(value) {
      throw new Error(value)
    }
  })
  await assert.rejects(failing.saveMcp({ ...mcpInput, expectedRevision: 1 }), {
    message: 'credential_storage_write_failed'
  })
  assert.deepEqual(await readFile(join(directory, 'model-connections.enc')), previous)
  assert.deepEqual((await store.acquireMcpForRun(saved)).values, mcpInput.values)
  assert.equal((await store.acquireForRun(model.id, model.revision)).apiKey, input.apiKey)
})

void test('the vault cannot commit ciphertext that exceeds its own read limit', async (t) => {
  const { directory, store } = await fixture(t)
  await store.save(input)
  const before = await readFile(join(directory, 'model-connections.enc'))
  const oversized = new ModelConnectionStore(directory, {
    ...cipher,
    encryptString() {
      return Buffer.alloc(8 * 1024 * 1024 + 1)
    }
  })
  await assert.rejects(oversized.saveMcp(mcpInput), { message: 'credential_storage_write_failed' })
  assert.deepEqual(await readFile(join(directory, 'model-connections.enc')), before)
})
