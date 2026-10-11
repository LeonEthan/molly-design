import {
  SaveModelConnectionSchema,
  DeleteModelConnectionSchema,
  type SaveModelConnection
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore } from './model-connection-store.ts'
import { revokeOAuthGrant } from './oauth-revocation.ts'

export async function saveModelConnection(
  store: ModelConnectionStore,
  input: SaveModelConnection,
  revoke = revokeOAuthGrant
) {
  const parsed = SaveModelConnectionSchema.safeParse(input)
  if (!parsed.success) throw new Error('invalid_model_connection')
  const data = parsed.data
  if (data.id && data.expectedRevision !== undefined) {
    const saved = await store.oauthForCheck(data.id, data.expectedRevision)
    if (
      saved &&
      data.apiKey &&
      data.authType !== 'openai_oauth' &&
      saved.connection.providerPresetId !== data.providerPresetId
    )
      await revoke(saved.connection.providerPresetId, saved.oauth).catch(() => undefined)
  }
  return store.save(data)
}

export async function deleteModelConnection(
  store: ModelConnectionStore,
  input: { id: string; expectedRevision: number },
  revoke = revokeOAuthGrant
) {
  const parsed = DeleteModelConnectionSchema.safeParse(input)
  if (!parsed.success) throw new Error('invalid_model_connection')
  const saved = await store.oauthForCheck(parsed.data.id, parsed.data.expectedRevision)
  if (saved) await revoke(saved.connection.providerPresetId, saved.oauth).catch(() => undefined)
  return store.delete(parsed.data)
}
