import type { BrowserAccountImportErrorCode } from '@molly/shared/electron-ipc'

export class BrowserAccountError extends Error {
  readonly code: BrowserAccountImportErrorCode

  constructor(code: BrowserAccountImportErrorCode) {
    super(code)
    this.code = code
  }
}

export function browserAccountSourceError(error: unknown): BrowserAccountError {
  if (error instanceof BrowserAccountError) return error
  if (error instanceof Error && error.message.startsWith('__ROOKIE_ERROR_V1__')) {
    try {
      const diagnostic: unknown = JSON.parse(error.message.slice('__ROOKIE_ERROR_V1__'.length))
      if (typeof diagnostic === 'object' && diagnostic !== null && 'rookieCode' in diagnostic) {
        if (diagnostic.rookieCode === 'molly_source_access_denied')
          return new BrowserAccountError('source-access-denied')
        if (diagnostic.rookieCode === 'molly_source_authorization_denied')
          return new BrowserAccountError('source-authorization-denied')
      }
    } catch {
      return new BrowserAccountError('source-unavailable')
    }
  }
  return new BrowserAccountError('source-unavailable')
}
