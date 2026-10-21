import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ModelConnectionSchema,
  compatibleConnectionApiRequiresKey,
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
    /** Dynamic client id OpenAI issued for this login's refresh grant. */
    clientId: z.string().max(200).optional(),
    idToken: z.string().min(1).max(16_384).optional(),
    subject: z.string().min(1).max(200).optional(),
    scopes: z.array(z.string().min(1).max(200)).max(64).optional()
  })
  .strict()
export type OAuthTokenSet = z.infer<typeof OAuthTokenSetSchema>
export type OpenAiSignInRegistration = Pick<OAuthTokenSet, 'clientId' | 'subject' | 'idToken'>
const OpenAiRegistrationSchema = OAuthTokenSetSchema.pick({ clientId: true, subject: true })

const StoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationId: z.uuid().optional(),
    entries: z
      .array(
        z
          .object({
            connection: ModelConnectionSchema,
            apiKey: z.string().max(16_384).optional(),
            oauth: OAuthTokenSetSchema.optional(),
            registration: OpenAiRegistrationSchema.optional()
          })
          .strict()
          .refine(
            (entry) =>
              entry.apiKey !== '' || entry.connection.providerPresetId === 'openai-compatible'
          )
          .refine(
            (entry) =>
              [entry.apiKey, entry.oauth, entry.registration].filter((value) => value !== undefined)
                .length === 1,
            'exactly one credential or registration kind'
          )
          .refine(
            (entry) =>
              !entry.registration ||
              (entry.connection.providerPresetId === 'openai' &&
                entry.connection.authType === 'openai_oauth' &&
                !entry.connection.enabled)
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
export type StoreEntry = Store['entries'][number]
export type BeforeConnectionChange = (previous?: StoreEntry) => Promise<boolean>

function publicConnection(entry: StoreEntry): ModelConnection {
  return entry.registration || entry.oauth?.denied
    ? {
        ...entry.connection,
        oauth: {
          ...entry.connection.oauth,
          ...(entry.registration ? { signedOut: true } : { denied: true })
        }
      }
    : entry.connection
}

/** Main-only: never register this class with renderer IPC or include entries in diagnostics. */
export class ModelConnectionStore {
  private readonly directory: string
  private readonly cipher: CredentialCipher
  private readonly platform: NodeJS.Platform
  private pending: Promise<unknown> = Promise.resolve()
  private readonly oauthPending = new Map<string, Promise<unknown>>()

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

  private serialConnection<T>(connectionId: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!connectionId) return fn()
    const previous = this.oauthPending.get(connectionId) ?? Promise.resolve()
    const operation = previous.then(fn)
    const settled = operation.catch(() => undefined)
    this.oauthPending.set(connectionId, settled)
    void settled.then(() => {
      if (this.oauthPending.get(connectionId) === settled) this.oauthPending.delete(connectionId)
    })
    return operation
  }

  private changeConnection<T>(
    queueId: string | undefined,
    prepare: (store: Store) => { previous?: StoreEntry; next?: StoreEntry; result: T },
    beforeChange?: BeforeConnectionChange
  ): Promise<T> {
    return this.serialConnection(queueId, async () => {
      const apply = async (store: Store, change: ReturnType<typeof prepare>) => {
        const index = change.previous ? store.entries.indexOf(change.previous) : -1
        if (index === -1) {
          if (change.next) store.entries.push(change.next)
        } else if (change.next) store.entries[index] = change.next
        else store.entries.splice(index, 1)
        await this.write(store)
        return change.result
      }
      if (!beforeChange)
        return this.serial(async () => {
          const store = await this.read()
          return apply(store, prepare(store))
        })
      const prepared = await this.serial(async () => prepare(await this.read()))
      const revocationAttempted = await beforeChange(prepared.previous)
      try {
        return await this.serial(async () => {
          const store = await this.read()
          const current = prepare(store)
          if (JSON.stringify(current.previous) !== JSON.stringify(prepared.previous))
            throw new Error('model_connection_revision_conflict')
          return apply(store, { ...prepared, previous: current.previous })
        })
      } catch (error) {
        const previous = prepared.previous
        if (revocationAttempted && previous?.oauth)
          await this.serial(async () => {
            const store = await this.read()
            const current = store.entries.find(
              (entry) => entry.connection.id === previous.connection.id
            )
            if (
              current?.oauth &&
              current.connection.credentialRef === previous.connection.credentialRef &&
              current.connection.providerPresetId === previous.connection.providerPresetId &&
              current.connection.baseUrl === previous.connection.baseUrl &&
              JSON.stringify(current.oauth) === JSON.stringify(previous.oauth)
            ) {
              current.oauth.denied = true
              await this.write(store)
            }
          }).catch(() => undefined)
        throw error
      }
    })
  }

  private async readEncrypted(): Promise<Buffer | undefined> {
    this.assertProtectedStorage()
    let handle
    try {
      handle = await open(
        join(this.directory, 'model-connections.enc'),
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      // eslint-disable-next-line preserve-caught-error -- Storage causes may contain sensitive paths or input.
      throw new Error('credential_storage_read_failed')
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('invalid_vault')
      return await handle.readFile()
    } catch {
      throw new Error('credential_storage_unreadable')
    } finally {
      await handle.close()
    }
  }

  private parse(bytes: Buffer): Store {
    try {
      const raw: unknown = JSON.parse(this.cipher.decryptString(bytes))
      // Pre-migration vaults stored a grantSeq counter on OAuth rows; strip it so the
      // strict schema does not reject the whole vault.
      if (raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown[] }).entries))
        for (const entry of (
          raw as {
            entries: {
              connection?: { providerPresetId?: unknown }
              oauth?: { grantSeq?: unknown; clientId?: unknown; denied?: boolean }
            }[]
          }
        ).entries) {
          if (!entry?.oauth) continue
          if (entry.oauth.grantSeq !== undefined) delete entry.oauth.grantSeq
          // Codex-era OpenAI rows predate dynamic client registration; their refresh
          // grants cannot be exchanged by the official flow, so they need a fresh
          // sign-in. Other providers (Kimi) never had a client id and are unaffected.
          if (
            entry.connection?.providerPresetId === 'openai' &&
            typeof entry.oauth.clientId !== 'string'
          )
            entry.oauth.denied = true
        }
      const parsed = StoreSchema.parse(raw)
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
    }
  }

  private async read(): Promise<Store> {
    const bytes = await this.readEncrypted()
    return bytes ? this.parse(bytes) : { schemaVersion: 1, entries: [] }
  }

  private async recoveryCandidate(): Promise<{ bytes: Buffer; digest: string }> {
    const bytes = await this.readEncrypted()
    if (!bytes) throw new Error('credential_storage_recovery_not_needed')
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') }
  }

  private assertUnreadable(bytes: Buffer): void {
    try {
      this.parse(bytes)
    } catch (error) {
      if (error instanceof Error && error.message === 'credential_storage_unreadable') return
      throw error
    }
    throw new Error('credential_storage_recovery_not_needed')
  }

  prepareRecovery(): Promise<{ digest: string }> {
    return this.serial(async () => {
      const { bytes, digest } = await this.recoveryCandidate()
      this.assertUnreadable(bytes)
      return { digest }
    })
  }

  recoverUnreadableStorage(input: { digest: string }): Promise<{ backupFileName: string }> {
    return this.serial(async () => {
      const { bytes, digest } = await this.recoveryCandidate()
      if (digest !== input.digest) throw new Error('credential_storage_recovery_conflict')
      this.assertUnreadable(bytes)
      const backupFileName = `model-connections.unreadable-${randomUUID()}.enc`
      try {
        await rename(
          join(this.directory, 'model-connections.enc'),
          join(this.directory, backupFileName)
        )
        if (this.platform !== 'win32') {
          const directory = await open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        }
      } catch {
        throw new Error('credential_storage_recovery_failed')
      }
      return { backupFileName }
    })
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
      connections: (await this.read()).entries.map(publicConnection)
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

  save(
    input: SaveModelConnection,
    beforeChange?: BeforeConnectionChange
  ): Promise<ModelConnection> {
    const parsed = SaveModelConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_model_connection'))
    const data = parsed.data
    return this.changeConnection(
      data.apiKey !== undefined ? data.id : undefined,
      (store) => {
        const previous = data.id
          ? store.entries.find((entry) => entry.connection.id === data.id)
          : undefined
        if (data.id && (!previous || previous.connection.revision !== data.expectedRevision)) {
          throw new Error('model_connection_revision_conflict')
        }
        if (!data.id && data.expectedRevision !== undefined)
          throw new Error('model_connection_revision_conflict')
        if (!previous && store.entries.length >= 256) throw new Error('model_connection_limit')
        // Editing an OAuth connection keeps its stored auth type and token set — but only
        // while the provider stays put. A provider switch means a different credential
        // shape: OAuth metadata is dropped and the submitted api key rules.
        const providerChanged =
          previous !== undefined && previous.connection.providerPresetId !== data.providerPresetId
        const effectiveAuthType = providerChanged
          ? data.authType
          : (data.authType ??
            (previous?.connection.authType === 'openai_oauth' ? 'openai_oauth' : undefined))
        if (providerChanged && effectiveAuthType === 'openai_oauth')
          throw new Error('model_connection_oauth_requires_reauth')
        const apiKey = data.apiKey ?? (providerChanged ? undefined : previous?.apiKey)
        if (
          data.providerPresetId === 'openai-compatible' &&
          compatibleConnectionApiRequiresKey(data.compatibleApi) &&
          (apiKey === undefined || apiKey.length === 0)
        )
          throw new Error('model_connection_credential_required')
        if (effectiveAuthType !== 'openai_oauth' && apiKey === undefined)
          throw new Error('model_connection_credential_required')
        // A changed destination must receive explicit renewed credential consent.
        if (
          previous &&
          data.apiKey === undefined &&
          (previous.connection.baseUrl !== data.baseUrl || providerChanged)
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
          // OAuth account metadata is main-owned and survives only same-provider edits.
          ...(previous?.connection.oauth && !providerChanged
            ? { oauth: previous.connection.oauth }
            : {}),
          ...(data.customModels ? { customModels: data.customModels } : {}),
          ...(data.models ? { models: data.models } : {}),
          ...(data.providerPresetId === 'openai-compatible'
            ? { compatibleApi: data.compatibleApi }
            : {})
        })
        const oauth = effectiveAuthType === 'openai_oauth' ? previous?.oauth : undefined
        const registration =
          effectiveAuthType === 'openai_oauth' ? previous?.registration : undefined
        if (registration && data.enabled) throw new Error('model_connection_signed_out')
        if (previous && effectiveAuthType === 'openai_oauth' && !oauth && !registration)
          throw new Error('model_connection_oauth_required')
        // Leaving OAuth for the same provider still requires a fresh sign-in; switching
        // provider already dropped the grant above, so only the api-key path remains.
        if (
          previous &&
          (previous.oauth || previous.registration) &&
          effectiveAuthType !== 'openai_oauth' &&
          !providerChanged
        )
          throw new Error('model_connection_oauth_requires_reauth')
        const credential =
          effectiveAuthType === 'openai_oauth'
            ? { connection, ...(oauth ? { oauth } : { registration }) }
            : { connection, apiKey }
        return { previous, next: credential, result: publicConnection(credential) }
      },
      beforeChange
    )
  }

  delete(
    input: { id: string; expectedRevision: number },
    beforeChange?: BeforeConnectionChange
  ): Promise<void> {
    const parsed = DeleteModelConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_model_connection'))
    return this.changeConnection(
      parsed.data.id,
      (store) => {
        const current = store.entries.find((entry) => entry.connection.id === parsed.data.id)
        if (!current || current.connection.revision !== parsed.data.expectedRevision) {
          throw new Error('model_connection_revision_conflict')
        }
        return { previous: current, result: undefined }
      },
      beforeChange
    )
  }

  signOutOAuth(
    input: { id: string; expectedRevision: number },
    beforeChange: BeforeConnectionChange
  ): Promise<void> {
    const parsed = DeleteModelConnectionSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new Error('invalid_model_connection'))
    return this.changeConnection(
      parsed.data.id,
      (store) => {
        const current = store.entries.find((entry) => entry.connection.id === parsed.data.id)
        if (!current || current.connection.revision !== parsed.data.expectedRevision)
          throw new Error('model_connection_revision_conflict')
        if (current.connection.authType !== 'openai_oauth')
          throw new Error('model_connection_oauth_required')
        if (current.connection.providerPresetId !== 'openai')
          return { previous: current, result: undefined }
        const identity = current.oauth ?? current.registration
        if (!identity) throw new Error('model_connection_oauth_required')
        const next: StoreEntry = {
          connection: {
            ...current.connection,
            revision: current.connection.revision + 1,
            enabled: false
          },
          registration: OpenAiRegistrationSchema.parse({
            clientId: identity.clientId,
            subject: identity.subject
          })
        }
        return { previous: current, next, result: undefined }
      },
      beforeChange
    )
  }

  openAiRegistrationForSignIn(
    connectionId: string,
    revision: number
  ): Promise<OpenAiSignInRegistration | null> {
    return this.serial(async () => {
      const entry = (await this.read()).entries.find((item) => item.connection.id === connectionId)
      if (
        !entry ||
        entry.connection.revision !== revision ||
        entry.connection.providerPresetId !== 'openai' ||
        entry.connection.authType !== 'openai_oauth'
      )
        return null
      const identity = entry.oauth ?? entry.registration
      return identity
        ? {
            ...(identity.clientId !== undefined ? { clientId: identity.clientId } : {}),
            ...(identity.subject !== undefined ? { subject: identity.subject } : {}),
            ...(entry.oauth?.idToken !== undefined ? { idToken: entry.oauth.idToken } : {})
          }
        : null
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

  async saveOAuthConnection(
    input: SaveModelConnection,
    tokens: OAuthTokenSet,
    account: { email?: string; plan?: string; accountId?: string },
    beforeChange?: BeforeConnectionChange
  ): Promise<{ connection: ModelConnection }> {
    const parsed = SaveModelConnectionSchema.safeParse(input)
    if (!parsed.success || parsed.data.authType !== 'openai_oauth')
      return Promise.reject(new Error('invalid_model_connection'))
    const data = parsed.data
    const binding = await this.serial(async () =>
      (await this.read()).entries.find((item) =>
        data.id
          ? item.connection.id === data.id
          : item.connection.authType === 'openai_oauth' &&
            item.connection.providerPresetId === data.providerPresetId
      )
    )
    return this.changeConnection(
      binding?.connection.id ?? data.id ?? `oauth:${data.providerPresetId}`,
      (store) => {
        const providerRow = store.entries.find(
          (item) =>
            item.connection.authType === 'openai_oauth' &&
            item.connection.providerPresetId === data.providerPresetId
        )
        const replaced = data.id
          ? store.entries.find((item) => item.connection.id === data.id)
          : providerRow
        if (!data.id && replaced?.registration)
          throw new Error('model_connection_oauth_provider_conflict')
        if (
          !data.id &&
          (replaced?.connection.id !== binding?.connection.id ||
            replaced?.connection.revision !== binding?.connection.revision)
        )
          throw new Error('model_connection_revision_conflict')
        if (data.id && (!replaced || replaced.connection.revision !== data.expectedRevision))
          throw new Error('model_connection_revision_conflict')
        if (!data.id && data.expectedRevision !== undefined)
          throw new Error('model_connection_revision_conflict')
        if (data.id && providerRow && providerRow !== replaced)
          throw new Error('model_connection_oauth_provider_conflict')
        if (!replaced && store.entries.length >= 256) throw new Error('model_connection_limit')
        const sameProvider = replaced?.connection.providerPresetId === data.providerPresetId
        const models = data.models ?? (sameProvider ? replaced?.connection.models : undefined)
        const connection = ModelConnectionSchema.parse({
          schemaVersion: 1,
          id: replaced?.connection.id ?? randomUUID(),
          revision: (replaced?.connection.revision ?? 0) + 1,
          credentialRef: replaced?.connection.credentialRef ?? randomUUID(),
          displayName: replaced?.connection.displayName ?? data.displayName,
          providerPresetId: data.providerPresetId,
          baseUrl: data.baseUrl,
          enabled: replaced?.connection.enabled ?? data.enabled,
          authType: 'openai_oauth',
          oauth: account,
          ...(models ? { models } : {})
        })
        return {
          previous: replaced,
          next: {
            connection,
            oauth: OAuthTokenSetSchema.parse({
              ...tokens,
              ...(account.accountId ? { accountId: account.accountId } : {})
            })
          },
          result: { connection }
        }
      },
      beforeChange
    )
  }

  /** The OAuth token set of one connection (main-process only). */
  oauthFor(connectionId: string): Promise<OAuthTokenSet | undefined> {
    return this.serial(async () => {
      const store = await this.read()
      return store.entries.find((item) => item.connection.id === connectionId)?.oauth
    })
  }

  hasOAuthGrant(providerPresetId: string, tokens: OAuthTokenSet): Promise<boolean> {
    return this.serial(async () =>
      (await this.read()).entries.some(
        (entry) =>
          entry.connection.providerPresetId === providerPresetId &&
          entry.oauth !== undefined &&
          entry.oauth.refreshToken === tokens.refreshToken &&
          entry.oauth.clientId === tokens.clientId
      )
    )
  }

  mutateOAuth(
    connectionId: string,
    fn: (current: OAuthTokenSet | undefined) => Promise<OAuthTokenSet | undefined>,
    expectedRevision?: number
  ): Promise<OAuthTokenSet | undefined> {
    return this.serialConnection(connectionId, async () => {
      const initial = await this.serial(async () =>
        (await this.read()).entries.find((item) => item.connection.id === connectionId)
      )
      if (
        !initial?.oauth ||
        initial.connection.authType !== 'openai_oauth' ||
        (expectedRevision !== undefined && initial.connection.revision !== expectedRevision)
      )
        return undefined
      const expectedTokens = JSON.stringify(initial.oauth)
      const next = await fn(initial.oauth)
      return this.serial(async () => {
        const store = await this.read()
        const current = store.entries.find((item) => item.connection.id === connectionId)
        if (
          !current?.oauth ||
          current.connection.authType !== 'openai_oauth' ||
          current.connection.credentialRef !== initial.connection.credentialRef ||
          current.connection.providerPresetId !== initial.connection.providerPresetId ||
          current.connection.baseUrl !== initial.connection.baseUrl ||
          JSON.stringify(current.oauth) !== expectedTokens
        )
          return undefined
        if (next !== undefined && next !== initial.oauth) {
          current.oauth = next
          await this.write(store)
        }
        return current.oauth
      })
    })
  }

  /** Stable installation id sent to OpenAI as the agent host id on first login. */
  deviceId(): Promise<string> {
    return this.serial(async () => {
      const store = await this.read()
      if (!store.installationId) {
        store.installationId = randomUUID()
        await this.write(store)
      }
      return store.installationId
    })
  }
}
