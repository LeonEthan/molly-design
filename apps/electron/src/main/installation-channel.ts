import { app } from 'electron'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const metadata = app.isPackaged
  ? JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
  : {}
const channel: unknown = metadata.mollyChannel ?? 'stable'
if (channel !== 'stable' && channel !== 'preview') {
  throw new Error('Unsupported packaged Molly installation channel')
}

export const desktopInstallationChannel = channel
process.env.MOLLY_INSTALLATION_CHANNEL = channel

if (channel === 'preview') {
  process.env.MOLLY_DATA_DIR = path.join(os.homedir(), '.molly-preview')
  process.env.MOLLY_ELECTRON_USER_DATA_DIR = path.join(app.getPath('appData'), 'Molly Preview')
}
