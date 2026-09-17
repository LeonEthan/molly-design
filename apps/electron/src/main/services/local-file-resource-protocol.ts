import { protocol } from 'electron'
import { LocalFileResources } from './local-file-resource'

export const localFileResources = new LocalFileResources()

export function registerLocalFileResourceScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'molly-resource',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function installLocalFileResourceProtocol() {
  protocol.handle('molly-resource', (request) => localFileResources.respond(request))
}
