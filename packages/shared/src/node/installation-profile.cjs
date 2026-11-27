const fs = require('node:fs');
const { createHash } = require('node:crypto');
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

const experimentalMarker = '.molly-mygo-experimental';
function canonicalDataDirectory(directory) {
  const absolute = path.resolve(directory);
  const tail = [];
  let ancestor = absolute;
  while (
    !fs.lstatSync(ancestor, {
      throwIfNoEntry: false,
    })
  ) {
    if (ancestor === path.dirname(ancestor)) throw Error('missing_data_directory_volume');
    tail.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(fs.realpathSync.native(ancestor), ...tail);
}
function defaultRoots(homeDir) {
  return ['.molly', '.molly-preview', '.lody'].map((name) =>
    canonicalDataDirectory(path.join(homeDir, name))
  );
}
function dataDirectoryScope(directory, homeDir = os.homedir()) {
  const canonical = canonicalDataDirectory(directory);
  if (defaultRoots(homeDir).includes(canonical)) return null;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
function markerStat(root) {
  return fs.lstatSync(path.join(root, experimentalMarker), {
    throwIfNoEntry: false,
  });
}
function experimentalScope(directory) {
  if (
    process.env.MOLLY_SUPERVISOR_TRANSPORT !== 'stdin' ||
    (process.env.MOLLY_E2E ?? process.env.LODY_E2E) === '1' ||
    !markerStat(directory)?.isFile()
  )
    return null;
  return dataDirectoryScope(directory);
}
function containsDirectory(parent, child) {
  const info = fs.statSync(parent, {
    throwIfNoEntry: false,
    bigint: true,
  });
  let current = child;
  for (;;) {
    if (current === parent) return true;
    const stat = fs.statSync(current, {
      throwIfNoEntry: false,
      bigint: true,
    });
    if (info && stat && info.ino !== 0n && stat.ino === info.ino && stat.dev === info.dev)
      return true;
    const next = path.dirname(current);
    if (next === current) return false;
    current = next;
  }
}
function validateStartupDataDirectory(directory = getMollyDataDir()) {
  const marker = markerStat(directory);
  if (marker && process.env.MOLLY_SUPERVISOR_TRANSPORT !== 'stdin')
    throw Error('experimental_dir_owned_by_mygo_shell');
  if (
    process.env.MOLLY_ISOLATED_DATA_ROOT_STRICT !== '1' &&
    process.env.MOLLY_SUPERVISOR_TRANSPORT !== 'stdin'
  )
    return;
  const canonical = canonicalDataDirectory(directory);
  const overlaps = defaultRoots(os.homedir()).some(
    (root) => containsDirectory(root, canonical) || containsDirectory(canonical, root)
  );
  if (overlaps || !marker?.isFile() || fs.lstatSync(directory).isSymbolicLink())
    throw Error('invalid_isolated_data_root');
  for (const name of fs.readdirSync(directory)) resolveIsolatedDataPath(directory, name);
}
function resolveIsolatedDataPath(root, ...segments) {
  if (process.env.MOLLY_ISOLATED_DATA_ROOT_STRICT !== '1') return path.join(root, ...segments);
  let current = path.resolve(root);
  if (
    fs
      .lstatSync(current, {
        throwIfNoEntry: false,
      })
      ?.isSymbolicLink()
  )
    throw Error('isolated_data_path_symlink');
  for (const segment of segments) {
    if (path.isAbsolute(segment)) throw Error('isolated_data_path_escape');
    for (const component of segment.split(process.platform === 'win32' ? /[\\/]/ : '/')) {
      if (component === '..') throw Error('isolated_data_path_escape');
      current = path.join(current, component);
      if (
        fs
          .lstatSync(current, {
            throwIfNoEntry: false,
          })
          ?.isSymbolicLink()
      )
        throw Error('isolated_data_path_symlink');
    }
  }
  return current;
}

function resolveIsolatedSqlitePath(root, ...segments) {
  const database = resolveIsolatedDataPath(root, ...segments);
  if (process.env.MOLLY_ISOLATED_DATA_ROOT_STRICT === '1') {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const stat = fs.lstatSync(database + suffix, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) throw Error('isolated_data_path_symlink');
      if (stat && (!stat.isFile() || stat.nlink !== 1)) throw Error('invalid_isolated_sqlite_file');
    }
  }
  return database;
}

module.exports = {
  getInstallationProfile,
  getMollyDataDir,
  canonicalDataDirectory,
  dataDirectoryScope,
  experimentalScope,
  validateStartupDataDirectory,
  resolveIsolatedDataPath,
  resolveIsolatedSqlitePath,
};
