import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacyUserDataDir } from './user-data-migration-core'
import { isLocalPlatform } from './platform'

// Side effect at import time: this must stay the first import in index.ts so
// the rename lands before any module (onboarding-state's Conf store, auth)
// resolves paths under userData.
// The display name is Molly; its existing storage identity is deliberately stable.
const userDataName = isLocalPlatform() ? 'Molly Design' : app.getName()
const userDataOverride =
  app.commandLine.getSwitchValue('user-data-dir') ||
  (process.env.MOLLY_ELECTRON_USER_DATA_DIR ?? process.env.LODY_ELECTRON_USER_DATA_DIR)
migrateLegacyUserDataDir({
  appDataDir: app.getPath('appData'),
  productName: userDataName,
  envOverride: userDataOverride
})
if (isLocalPlatform()) {
  app.setPath(
    'userData',
    userDataOverride?.trim() || path.join(app.getPath('appData'), userDataName)
  )
}

// The CLI data dir follows the same rename; the desktop pins MOLLY_DATA_DIR for
// every CLI child, so the CLI-side migration alone would never see the legacy
// path. Safe to run before cli-service spawns anything.
if (isLocalPlatform()) {
  migrateLegacyUserDataDir({
    appDataDir: os.homedir(),
    productName: '.molly',
    legacyProductNames: ['.geon', '.folio']
  })
}
