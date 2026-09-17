import fs from 'node:fs'
import path from 'node:path'

/**
 * One-time rename of a legacy userData directory (previous product names →
 * productName). Pure core with injectable paths so it is unit-testable without
 * Electron; the Electron wrapper lives in user-data-migration.ts.
 *
 * `legacyProductNames` is ordered newest first: the first legacy directory that
 * exists wins, so a `Geon` dev directory is preferred over an older `Folio` one
 * when both are present. Never includes `Lody` data.
 */
export function migrateLegacyUserDataDir(options: {
  appDataDir: string
  productName: string
  legacyProductNames?: string[]
  envOverride?: string | undefined
  log?: (message: string) => void
}): boolean {
  const {
    appDataDir,
    productName,
    legacyProductNames = ['Geon', 'Folio'],
    envOverride,
    log = console.warn
  } = options
  if (envOverride?.trim()) return false
  const current = path.join(appDataDir, productName)
  if (fs.existsSync(current)) return false
  for (const legacyProductName of legacyProductNames) {
    const legacy = path.join(appDataDir, legacyProductName)
    if (legacy === current || !fs.existsSync(legacy)) continue
    fs.renameSync(legacy, current)
    log(`[user-data-migration] Renamed legacy userData ${legacy} -> ${current}`)
    return true
  }
  return false
}
