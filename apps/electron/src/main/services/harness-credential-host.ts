import type { CliService } from './cli-service'
import { readLocalPlatformSnapshot } from '../platform'
import { getModelConnectionStore } from './model-connections'
import { startHarnessCredentialHostCore } from './harness-credential-host-core'

export function startHarnessCredentialHost(cliService: CliService): () => void {
  return startHarnessCredentialHostCore(cliService, {
    readPlatform: readLocalPlatformSnapshot,
    getStore: getModelConnectionStore
  })
}
