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
  if (data.apiKey === undefined || !data.id) return store.save(data)
  return store.save(data, async (saved) => {
    if (
      saved?.oauth &&
      data.apiKey !== undefined &&
      data.authType !== 'openai_oauth' &&
      saved.connection.providerPresetId !== data.providerPresetId
    ) {
      await revoke(saved.connection.providerPresetId, saved.oauth).catch(() => undefined)
      return true
    }
    return false
  })
}

export async function deleteModelConnection(
  store: ModelConnectionStore,
  input: { id: string; expectedRevision: number },
  revoke = revokeOAuthGrant
) {
  const parsed = DeleteModelConnectionSchema.safeParse(input)
  if (!parsed.success) throw new Error('invalid_model_connection')
  return store.delete(parsed.data, async (saved) => {
    if (!saved?.oauth) return false
    await revoke(saved.connection.providerPresetId, saved.oauth).catch(() => undefined)
    return true
  })
}

export async function signOutModelConnection(
  store: ModelConnectionStore,
  input: { id: string; expectedRevision: number },
  revoke = revokeOAuthGrant
) {
  let revocationConfirmed = false
  await store.signOutOAuth(input, async (saved) => {
    if (!saved?.oauth) return false
    revocationConfirmed = await revoke(saved.connection.providerPresetId, saved.oauth).catch(
      () => false
    )
    return true
  })
  return { revocationConfirmed }
}
