import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function inspectIsolatedRoot(root: string) {
  if (
    !path.isAbsolute(root) ||
    root.split(process.platform === 'win32' ? /[\\/]/ : '/').includes('..')
  )
    throw Error('invalid_isolated_data_root');
  const canonical = realpathSync.native(root);
  if (canonical !== path.resolve(root)) throw Error('isolated_data_path_symlink');
  for (
    let current = canonical;
    current !== path.dirname(current);
    current = path.dirname(current)
  ) {
    if (lstatSync(current).isSymbolicLink()) throw Error('isolated_data_path_symlink');
  }
  const stat = lstatSync(canonical, { bigint: true });
  if (!stat.isDirectory()) throw Error('invalid_isolated_data_root');
  return {
    isolatedDataRoot: root,
    isolatedRootCanonicalPath: canonical,
    isolatedRootDev: stat.dev.toString(),
    isolatedRootIno: stat.ino.toString(),
  };
}
