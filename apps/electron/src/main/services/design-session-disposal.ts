import type { Session } from 'electron'

/** Native sessions outlive their views. Replace every per-surface callback so
 * its shared closure cannot retain the editor shell, document or assets.
 * Keep retired sessions fail-closed rather than restoring Electron defaults. */
export function retireDesignSession(
  isolated: Pick<
    Session,
    'protocol' | 'webRequest' | 'setPermissionRequestHandler' | 'setPermissionCheckHandler'
  >
) {
  isolated.protocol.unhandle('molly-design')
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.webRequest.onBeforeRequest((_details, done) => done({ cancel: true }))
}
