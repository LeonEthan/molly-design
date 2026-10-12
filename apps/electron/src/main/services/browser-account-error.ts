import type { BrowserAccountImportErrorCode } from '@molly/shared/electron-ipc'

export class BrowserAccountError extends Error {
  readonly code: BrowserAccountImportErrorCode

  constructor(code: BrowserAccountImportErrorCode) {
    super(code)
    this.code = code
  }
}
