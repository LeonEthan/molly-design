import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  getInstallationProfile
} = require('../../../packages/shared/src/node/installation-profile.cjs')
export const previewProfile = getInstallationProfile('local', 'preview')

export function previewPackagingConfig() {
  return {
    appId: previewProfile.desktopAppId,
    productName: previewProfile.desktopProductName,
    protocols: { name: 'Molly Preview Desktop', schemes: [previewProfile.desktopProtocol] },
    directories: { output: 'dist/preview' },
    extraMetadata: {
      name: 'molly-preview',
      productName: previewProfile.desktopProductName,
      mollyChannel: 'preview'
    },
    publish: null,
    mac: {
      notarize: false,
      timestamp: 'none',
      extendInfo: { SUFeedURL: '', SUPublicEDKey: '', SUEnableAutomaticChecks: false }
    }
  }
}
