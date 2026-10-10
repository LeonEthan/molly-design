import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ModelConnectionSchema,
  SaveModelConnectionSchema,
  DeleteModelConnectionSchema,
  DeleteImageConnectionSchema,
  ProtectedImageConnectionSchema,
  SaveProtectedImageConnectionSchema,
  LegacyImageCredentialSchema,
  McpCredentialBindingSchema,
  SaveMcpCredentialSchema,
  DeleteMcpCredentialSchema,
  StoredMcpCredentialSchema,
  sameMcpDestination,
  type McpCredentialBinding,
  type SaveMcpCredential,
  type ProtectedImageConnection,
  type SaveProtectedImageConnection,
  type LegacyImageCredential,
  type ModelConnection,
  type SaveModelConnection,
  type DeleteImageConnection
} from '@molly/shared/embedded-harness'

export interface CredentialCipher {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend(): string
}

/** OAuth token triple for an OpenAI sign-in; refresh rotates, so the whole set is replaced. */
const OAuthTokenSetSchema = z
  .object({
    accessToken: z.string().min(1).max(16_384),
    refreshToken: z.string().min(1).max(16_384),
    /** Epoch milliseconds when the access token expires (JWT exp). */
    accessTokenExpiresAt: z.number().int().positive(),
    /** Refresh was rejected; the row stays but runs refuse until the user signs in again. */
    denied: z.boolean().optional(),
    accountId: z.string().max(200).optional(),
    /**
     * Changes on every rotation so a queued grant carrying the previous token cannot be
     * honored after the vault moved on.
     */
    grantId: z.string().uuid().optional()
  })
  .strict()
export type OAuthTokenSet = z.infer<typeof OAuthTokenSetSchema>

const StoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z
      .array(
        z
          .object({
            connection: ModelConnectionSchema,
            apiKey: z.string().min(1).max(16_384).optional(),
            oauth: OAuthTokenSetSchema.optional()
          })
          .strict()
          .refine(
            (entry) => (entry.apiKey !== undefined) !== (entry.oauth !== undefined),
            'exactly one credential kind'
          )
      )
      .max(256),
    image: z
      .object({ connection: ProtectedImageConnectionSchema, apiKey: z.string().max(16_384) })
      .strict()
      .optional(),
    legacyImages: z.array(LegacyImageCredentialSchema).max(16).optional(),
    mcp: z.array(StoredMcpCredentialSchema).max(256).optional()
  })
  .strict()
type Store = z.infer<typeof StoreSchema>

/** Main-only: never register this class with renderer IPC or include entries in diagnostics. */
export class ModelConnectionStore {
  private readonly directory: string
  private readonly cipher: CredentialCipher
  private readonly platform: NodeJS.Platform
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    directory: string,
    cipher: CredentialCipher,
    platform: NodeJS.Platform = process.platform
  ) {
    this.directory = directory
    this.cipher = cipher
    this.platform = platform
  }

  private assertProtectedStorage(): void {
    if (
      !this.cipher.isEncryptionAvailable() ||
      (this.platform === 'linux' &&
        ['basic_text', 'unknown'].includes(this.cipher.getSelectedStorageBackend()))
    ) {
      throw new Error('credential_storage_unavailable')
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation)
    this.pending = next.catch(() => undefined)
    return next
  }

  private async read(): Promise<Store> {
    this.assertProtectedStorage()
    let handle
    try {
      handle = await open(
        join(this.directory, 'model-connections.enc'),
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, entries: [] }
      // eslint-disable-next-line preserve-caught-error -- Storage causes may contain sensitive paths or input.
      throw new Error('credential_storage_read_failed')
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('invalid_vault')
      const parsed = StoreSchema.parse(
        JSON.parse(this.cipher.decryptString(await handle.readFile()))
      )
      if (
        new Set(parsed.entries.map((entry) => entry.connection.id)).size !== parsed.entries.length
      ) {
        throw new Error('duplicate_connection')
      }
      const mcp = parsed.mcp ?? []
      if (
        new Set(
          mcp.map(({ connection }) => JSON.stringify([connection.workspaceId, connection.serverId]))
        ).size !== mcp.length ||
        new Set(mcp.map(({ connection }) => connection.credentialRef)).size !== mcp.length
      )
        throw new Error('duplicate_mcp_credential')
      return parsed
    } catch {
      // Decryption/schema errors may include input. Never cross IPC with their details.
      throw new Error('credential_storage_unreadable')
    } finally {
      await handle.close()
    }
  }

  private async write(store: Store): Promise<void> {
    this.assertProtectedStorage()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temp = join(this.directory, `${randomUUID()}.tmp`)
    let created = false
    try {
      const encrypted = this.cipher.encryptString(JSON.stringify(StoreSchema.parse(store)))
      if (encrypted.byteLength > 8 * 1024 * 1024) throw new Error('vault_size_limit')
      const handle = await open(temp, 'wx', 0o600)
      created = true
      try {
        await handle.writeFile(encrypted)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, join(this.directory, 'model-connections.enc'))
      created = false
      if (this.platform !== 'win32') {
        const directory = await open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } catch {
      throw new Error('credential_storage_write_failed')
    } finally {
      if (created) await unlink(temp).catch(() => undefined)
    }
  }

  /** Public snapshot: renderer sees the denial flag, never the tokens. */
  snapshot(): Promise<{ connections: ModelConnection[] }> {
    return this.serial(async () => ({
      connections: (await this.read()).entries.map((entry) => {
        if (!entry.oauth) return entry.connection
        return {
          ...entry.connection,
          oauth: { ...entry.connection.oauth, ...(entry.oauth.denied ? { denied: true } : {}) }
        }
      })
    }))
  }

  imageSnapshot(): Promise<{ connection: ProtectedImageConnection | null }> {
    return this.serial(async () => ({ connection: (await this.read()).image?.connection ?? null }))
  }

  mcpSnapshot(): Promise<{ connections: McpCredentialBinding[] }> {
    return this.serial(async () => ({
      connections: ((await this.read()).mcp ?? []).map((entry) => entry.connection)
    }))
  }

  saveMcp(input: SaveMcpCredential): Promise<McpCredentialBinding> {
    const parsed = SaveMcpCredentialSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_mcp_credential'))
    return this.serial(async () => {
      const data = parsed.data
      const store = await this.read()
      const entries = store.mcp ?? []
      const previous = entries.find(
        ({ connection }) =>
          connection.workspaceId === data.workspaceId && connection.serverId === data.serverId
      )
      if (data.expectedRevision !== previous?.connection.revision)
        throw new Error('mcp_credential_revision_conflict')
      if (!previous && entries.length >= 256) throw new Error('mcp_credential_limit')
      if (
        previous &&
        !data.values &&
        JSON.stringify(previous.connection.destination) !== JSON.stringify(data.destination)
      )
        throw new Error('mcp_credential_destination_requires_credential')
      const values = data.values ?? previous?.values
      if (!values) throw new Error('mcp_credential_required')
      const connection = McpCredentialBindingSchema.parse({
        workspaceId: data.workspaceId,
        serverId: data.serverId,
        credentialRef: previous?.connection.credentialRef ?? randomUUID(),
        revision: (previous?.connection.revision ?? 0) + 1,
        destination: data.destination,
        fieldNames: Object.keys(values).sort()
      })
      store.mcp = [...entries.filter((entry) => entry !== previous), { connection, values }]
      await this.write(store)
      return connection
    })
  }

  deleteMcp(input: z.infer<typeof DeleteMcpCredentialSchema>): Promise<void> {
    const parsed = DeleteMcpCredentialSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_mcp_credential'))
    return this.serial(async () => {
      const store = await this.read()
      const entries = store.mcp ?? []
      const previous = entries.find(
        ({ connection }) =>
          connection.workspaceId === parsed.data.workspaceId &&
          connection.serverId === parsed.data.serverId
      )
      if (!previous || previous.connection.revision !== parsed.data.expectedRevision)
        throw new Error('mcp_credential_revision_conflict')
      store.mcp = entries.filter((entry) => entry !== previous)
      await this.write(store)
    })
  }

  /** Main host only; the dispatcher must establish an active run lease before calling. */
  acquireMcpForRun(input: McpCredentialBinding) {
    const parsed = McpCredentialBindingSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('mcp_credential_unavailable'))
    return this.serial(async () => {
      const entry = ((await this.read()).mcp ?? []).find(
        ({ connection }) => JSON.stringify(connection) === JSON.stringify(parsed.data)
      )
      if (!entry) throw new Error('mcp_credential_unavailable')
      return entry
    })
  }

  /**
   * Settings tool listing only (A5): values for one explicit, user-initiated discovery of the
   * exact saved binding. No run lease exists here; workspace, server, reference, revision and
   * destination must all match, so a value never reaches another destination.
   */
  mcpValuesForDiscovery(input: {
    workspaceId: string
    serverId: string
    credentialRef: string
    revision: number
    destination: McpCredentialBinding['destination']
  }): Promise<Record<string, string> | null> {
    return this.serial(async () => {
      const entry = ((await this.read()).mcp ?? []).find(
        ({ connection }) =>
          connection.workspaceId === input.workspaceId &&
          connection.serverId === input.serverId &&
          connection.credentialRef === input.credentialRef &&
          connection.revision === input.revision &&
          sameMcpDestination(connection.destination, input.destination)
      )
      return entry ? { ...entry.values } : null
    })
  }

  saveImage(input: SaveProtectedImageConnection): Promise<ProtectedImageConnection> {
    const parsed = SaveProtectedImageConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_image_connection'))
    return this.serial(async () => {
      const data = parsed.data
      const store = await this.read()
      const previous = store.image
      if (data.expectedRevision !== previous?.connection.revision)
        throw new Error('image_connection_revision_conflict')
      if (
        previous &&
        previous.connection.baseUrl !== data.baseUrl &&
        !data.apiKey &&
        !data.clearApiKey
      )
        throw new Error('image_connection_destination_requires_credential')
      const apiKey = data.clearApiKey ? '' : (data.apiKey ?? previous?.apiKey ?? '')
      const connection = ProtectedImageConnectionSchema.parse({
        id: previous?.connection.id ?? randomUUID(),
        revision: (previous?.connection.revision ?? 0) + 1,
        enabled: data.enabled,
        ...(data.protocol === undefined ? {} : { protocol: data.protocol }),
        baseUrl: data.baseUrl,
        model: data.model,
        hasApiKey: apiKey.length > 0,
        legacyHistoryMayContainKey:
          previous?.connection.legacyHistoryMayContainKey ?? Boolean(store.legacyImages?.length)
      })
      store.image = { connection, apiKey }
      await this.write(store)
      return connection
    })
  }

  /** Removes the single image slot. Legacy backups stay: a late migration must not recreate it. */
  deleteImage(input: DeleteImageConnection): Promise<void> {
    const parsed = DeleteImageConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_image_connection'))
    return this.serial(async () => {
      const store = await this.read()
      const previous = store.image
      if (!previous || previous.connection.revision !== parsed.data.expectedRevision)
        throw new Error('image_connection_revision_conflict')
      delete store.image
      await this.write(store)
    })
  }

  /** Encrypt before acknowledging removal of the exact legacy row. Idempotent on redelivery. */
  importLegacyImage(input: LegacyImageCredential): Promise<void> {
    const parsed = LegacyImageCredentialSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_legacy_image_connection'))
    return this.serial(async () => {
      const legacy = parsed.data
      const store = await this.read()
      const backups = store.legacyImages ?? []
      if (backups.some((entry) => JSON.stringify(entry) === JSON.stringify(legacy))) {
        if (!store.image) throw new Error('legacy_image_configuration_requires_update')
        return
      }
      if (backups.length >= 16) throw new Error('legacy_image_backup_limit')
      store.legacyImages = [...backups, legacy]
      // A user-authored protected connection always wins over a late legacy migration.
      if (!store.image) {
        const connection = ProtectedImageConnectionSchema.safeParse({
          id: randomUUID(),
          revision: 1,
          enabled: legacy.enabled,
          baseUrl: legacy.baseUrl,
          model: legacy.model,
          hasApiKey: Boolean(legacy.apiKey),
          legacyHistoryMayContainKey: true
        })
        if (connection.success) store.image = { connection: connection.data, apiKey: legacy.apiKey }
      } else {
        store.image.connection.legacyHistoryMayContainKey = true
      }
      // Invalid old endpoints/models are backed up, never silently repaired or enabled.
      await this.write(store)
      if (!store.image) throw new Error('legacy_image_configuration_requires_update')
    })
  }

  /** Internal dispatcher only; never exposed as an IPC method. */
  acquireImageForRun(
    id: string,
    revision: number
  ): Promise<{ connection: ProtectedImageConnection; apiKey: string }> {
    return this.serial(async () => {
      const image = (await this.read()).image
      if (
        !image ||
        image.connection.id !== id ||
        image.connection.revision !== revision ||
        !image.connection.enabled ||
        !image.apiKey
      )
        throw new Error('image_connection_unavailable')
      return image
    })
  }

  save(input: SaveModelConnection): Promise<ModelConnection> {
    const parsed = SaveModelConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_model_connection'))
    return this.serial(async () => {
      const data = parsed.data
      const store = await this.read()
      const previous = data.id
        ? store.entries.find((entry) => entry.connection.id === data.id)
        : undefined
      if (data.id && (!previous || previous.connection.revision !== data.expectedRevision)) {
        throw new Error('model_connection_revision_conflict')
      }
      if (!data.id && data.expectedRevision !== undefined)
        throw new Error('model_connection_revision_conflict')
      if (!previous && store.entries.length >= 256) throw new Error('model_connection_limit')
      // Editing an OAuth connection keeps its stored auth type and token set; the form
      // never sends either.
      const effectiveAuthType =
        data.authType ??
        (previous?.connection.authType === 'openai_oauth' ? 'openai_oauth' : undefined)
      const apiKey = data.apiKey ?? previous?.apiKey
      if (effectiveAuthType !== 'openai_oauth' && !apiKey)
        throw new Error('model_connection_credential_required')
      // A changed destination must receive explicit renewed credential consent.
      if (
        previous &&
        !data.apiKey &&
        (previous.connection.baseUrl !== data.baseUrl ||
          previous.connection.providerPresetId !== data.providerPresetId)
      ) {
        throw new Error('model_connection_destination_requires_credential')
      }
      const connection = ModelConnectionSchema.parse({
        schemaVersion: 1,
        id: previous?.connection.id ?? randomUUID(),
        revision: (previous?.connection.revision ?? 0) + 1,
        credentialRef: previous?.connection.credentialRef ?? randomUUID(),
        displayName: data.displayName,
        providerPresetId: data.providerPresetId,
        baseUrl: data.baseUrl,
        enabled: data.enabled,
        ...(effectiveAuthType ? { authType: effectiveAuthType } : {}),
        // OAuth account metadata is main-owned: renderer edits preserve it verbatim.
        ...(previous?.connection.oauth ? { oauth: previous.connection.oauth } : {}),
        ...(data.customModels ? { customModels: data.customModels } : {}),
        ...(data.models ? { models: data.models } : {})
      })
      const oauth = effectiveAuthType === 'openai_oauth' ? previous?.oauth : undefined
      if (previous && effectiveAuthType === 'openai_oauth' && !oauth)
        throw new Error('model_connection_oauth_required')
      if (previous && previous.oauth && effectiveAuthType !== 'openai_oauth')
        throw new Error('model_connection_oauth_requires_reauth')
      const credential =
        effectiveAuthType === 'openai_oauth' ? { connection, oauth } : { connection, apiKey }
      store.entries = previous
        ? store.entries.map((entry) => (entry === previous ? credential : entry))
        : [...store.entries, credential]
      await this.write(store)
      return connection
    })
  }

  delete(input: { id: string; expectedRevision: number }): Promise<void> {
    const parsed = DeleteModelConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_model_connection'))
    return this.serial(async () => {
      const store = await this.read()
      const current = store.entries.find((entry) => entry.connection.id === parsed.data.id)
      if (!current || current.connection.revision !== parsed.data.expectedRevision) {
        throw new Error('model_connection_revision_conflict')
      }
      store.entries = store.entries.filter((entry) => entry !== current)
      await this.write(store)
    })
  }

  /** Main-only explicit settings check: the saved key of this exact revision, on or off. */
  credentialForCheck(
    connectionId: string,
    revision: number
  ): Promise<{ connection: ModelConnection; apiKey: string } | null> {
    return this.serial(async () => {
      const entry = (await this.read()).entries.find((item) => item.connection.id === connectionId)
      if (!entry || entry.connection.revision !== revision || entry.apiKey === undefined)
        return null
      return { connection: entry.connection, apiKey: entry.apiKey }
    })
  }

  /** Main-only: the OAuth token set of this exact revision, on or off. */
  oauthForCheck(
    connectionId: string,
    revision: number
  ): Promise<{ connection: ModelConnection; oauth: OAuthTokenSet } | null> {
    return this.serial(async () => {
      const entry = (await this.read()).entries.find((item) => item.connection.id === connectionId)
      if (!entry || entry.connection.revision !== revision || !entry.oauth) return null
      return { connection: entry.connection, oauth: entry.oauth }
    })
  }

  /** Main-only explicit settings check for the image connection, on or off. */
  imageCredentialForCheck(
    revision: number | undefined
  ): Promise<{ connection: ProtectedImageConnection; apiKey: string } | null> {
    return this.serial(async () => {
      const image = (await this.read()).image
      return image && image.connection.revision === revision ? image : null
    })
  }

  /** Internal broker only. Caller must first bind an active run/epoch to this revision. */
  acquireForRun(
    connectionId: string,
    revision: number
  ): Promise<
    | { connection: ModelConnection; apiKey: string }
    | { connection: ModelConnection; oauth: OAuthTokenSet }
  > {
    return this.serial(async () => {
      const entry = (await this.read()).entries.find((item) => item.connection.id === connectionId)
      if (!entry || !entry.connection.enabled || entry.connection.revision !== revision) {
        throw new Error('model_connection_unavailable')
      }
      if (entry.oauth) {
        if (entry.oauth.denied) throw new Error('model_connection_oauth_denied')
        return { connection: entry.connection, oauth: entry.oauth }
      }
      if (entry.apiKey === undefined) throw new Error('model_connection_unavailable')
      return { connection: entry.connection, apiKey: entry.apiKey }
    })
  }

  /** Completes an OAuth sign-in: creates the connection and its token set atomically. */
  saveOAuthConnection(
    input: SaveModelConnection,
    tokens: OAuthTokenSet,
    account: { email?: string; plan?: string; accountId?: string }
  ): Promise<ModelConnection> {
    const parsed = SaveModelConnectionSchema.safeParse(input)
    if (!parsed.success || parsed.data.authType !== 'openai_oauth')
      return Promise.reject(new Error('invalid_model_connection'))
    return this.serial(async () => {
      const store = await this.read()
      if (store.entries.length >= 256) throw new Error('model_connection_limit')
      const connection = ModelConnectionSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        revision: 1,
        credentialRef: randomUUID(),
        displayName: parsed.data.displayName,
        providerPresetId: parsed.data.providerPresetId,
        baseUrl: parsed.data.baseUrl,
        enabled: parsed.data.enabled,
        authType: 'openai_oauth',
        oauth: account,
        ...(parsed.data.models ? { models: parsed.data.models } : {})
      })
      store.entries = [
        ...store.entries,
        { connection, oauth: { ...tokens, grantId: randomUUID() } }
      ]
      await this.write(store)
      return connection
    })
  }

  /** Completes an OAuth sign-in: writes the token set onto the saved connection. */
  saveOAuthTokens(connectionId: string, expectedRevision: number, tokens: OAuthTokenSet) {
    return this.serial(async () => {
      const store = await this.read()
      const entry = store.entries.find((item) => item.connection.id === connectionId)
      if (!entry || entry.connection.revision !== expectedRevision)
        throw new Error('model_connection_revision_conflict')
      if (entry.connection.authType !== 'openai_oauth')
        throw new Error('model_connection_oauth_requires_reauth')
      entry.oauth = tokens
      await this.write(store)
    })
  }

  /** Rotates a refreshed token set in place; returns the stored set with its new grant id. */
  rotateOAuthTokens(
    connectionId: string,
    connectionRevision: number,
    tokens: OAuthTokenSet
  ): Promise<OAuthTokenSet> {
    return this.serial(async () => {
      const store = await this.read()
      const entry = store.entries.find((item) => item.connection.id === connectionId)
      if (!entry || entry.connection.revision !== connectionRevision)
        throw new Error('model_connection_revision_conflict')
      if (entry.connection.authType !== 'openai_oauth')
        throw new Error('model_connection_oauth_requires_reauth')
      // Rotation invalidates any grant minted from the previous token set.
      entry.oauth = { ...tokens, grantId: randomUUID() }
      await this.write(store)
      return entry.oauth
    })
  }
}
