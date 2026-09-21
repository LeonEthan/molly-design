import { app } from 'electron'
import path from 'node:path'

type ProtocolRegistrationLogger = (message: string, meta?: Record<string, unknown>) => void

interface RegisterProtocolClientOptions {
  protocol: string
  log: ProtocolRegistrationLogger
}

function resolveDefaultAppEntryPath(): string | null {
  const appPath = app.getAppPath()
  if (appPath) {
    return path.resolve(appPath)
  }

  const argvEntry = process.argv[1]
  if (argvEntry && !argvEntry.includes('://')) {
    return path.resolve(argvEntry)
  }

  return null
}

export function registerMollyProtocolClient(options: RegisterProtocolClientOptions): void {
  const { protocol, log } = options
  if (!app.isPackaged && (process.env.MOLLY_E2E ?? process.env.LODY_E2E) === '1') {
    log('registerLodyProtocolClient skipped for E2E', { protocol })
    return
  }
  const appEntry = resolveDefaultAppEntryPath()
  let registrationResult = false

  if (!app.isPackaged && appEntry) {
    registrationResult = app.setAsDefaultProtocolClient(protocol, process.execPath, [appEntry])
    log('registerLodyProtocolClient finished for dev mode', {
      registrationResult,
      protocol,
      appEntry,
      execPath: process.execPath,
      processPlatform: process.platform
    })
    return
  }

  registrationResult = app.setAsDefaultProtocolClient(protocol)
  log('registerLodyProtocolClient finished', {
    registrationResult,
    protocol,
    appEntry,
    isPackaged: app.isPackaged,
    processPlatform: process.platform
  })
}
