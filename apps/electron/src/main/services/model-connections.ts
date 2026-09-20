import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { ModelConnectionStore } from './model-connection-store'

let store: ModelConnectionStore | undefined
export function getModelConnectionStore(): ModelConnectionStore {
  if (!app.isReady()) throw new Error('credential_storage_not_ready')
  return (store ??= new ModelConnectionStore(join(app.getPath('userData'), 'secrets'), safeStorage))
}
