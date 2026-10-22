const os = require('node:os');
const path = require('node:path');

const CLOUD_PROFILE = Object.freeze({
  channel: 'stable',
  platform: 'cloud',
  namespace: 'lody',
  dataDirectoryName: '.lody',
  desktopProtocol: 'lody',
  desktopProductName: 'Lody',
  desktopAppId: 'ai.lody.desktop',
  localCliHostPort: 17788,
});

const LOCAL_PROFILE = Object.freeze({
  channel: 'stable',
  platform: 'local',
  namespace: 'molly',
  dataDirectoryName: '.molly',
  desktopProtocol: 'molly-design',
  desktopProductName: 'Molly',
  desktopAppId: 'dev.molly-design.app',
  localCliHostPort: 17792,
});

const PREVIEW_PROFILE = Object.freeze({
  channel: 'preview',
  platform: 'local',
  namespace: 'molly-preview',
  dataDirectoryName: '.molly-preview',
  desktopProtocol: 'molly-preview',
  desktopProductName: 'Molly Preview',
  desktopAppId: 'dev.molly-design.preview',
  localCliHostPort: 17794,
});

function resolvePlatformKind(raw) {
  const value = raw?.trim();
  if (!value) return 'local';
  if (value === 'local' || value === 'cloud') return value;
  throw new Error(
    `Unrecognized MOLLY_PLATFORM value: ${JSON.stringify(raw)} (expected "local" or "cloud")`
  );
}

function getInstallationProfile(
  platform = resolvePlatformKind(process.env.MOLLY_PLATFORM ?? process.env.LODY_PLATFORM),
  channel = process.env.MOLLY_INSTALLATION_CHANNEL ?? 'stable'
) {
  if (channel !== 'stable' && channel !== 'preview') {
    throw new Error(`Unrecognized MOLLY_INSTALLATION_CHANNEL: ${JSON.stringify(channel)}`);
  }
  return platform === 'cloud'
    ? CLOUD_PROFILE
    : channel === 'preview'
      ? PREVIEW_PROFILE
      : LOCAL_PROFILE;
}

function getMollyDataDir(platform, homeDir = os.homedir()) {
  const override = (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR)?.trim();
  if (override) return path.resolve(override);
  return path.join(homeDir, getInstallationProfile(platform).dataDirectoryName);
}

module.exports = { getInstallationProfile, getMollyDataDir };
