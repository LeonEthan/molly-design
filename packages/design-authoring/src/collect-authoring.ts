/**
 * Authoring snapshot collection seam (adapted from the pinned upstream;
 * see source-manifest.json). This is the trust boundary: allowlist + lstat
 * without following links. Consumers only receive the collected Map.
 *
 * Molly adaptation: the only authoring entry is `design.yaml` with local `media/` assets. Leftover `.pptd` is not
 * admitted. Upstream's AuthoringSnapshotError is replaced by a local error
 * class so the CAS workspace module is not migrated.
 */

import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  constants,
  type Stats,
} from 'node:fs';
import { join, sep } from 'node:path';
import { createHash, type Hash } from 'node:crypto';
import { parse } from 'yaml';
import { listSemanticAssetRefs } from './semantic-assets.ts';
import type { ValidatedArtwork } from './contracts.ts';
import { assetSizeFailure, describeAssetAdmissionFailure, MAX_ASSET_BYTES, type AssetAdmissionFailure } from './asset-admission.ts';

/** Snapshot collection integrity failure (symlink/hardlink/escape/non-regular). */
export class AuthoringSnapshotError extends Error {
  constructor(message: string, readonly assetFailure?: AssetAdmissionFailure) {
    super(message);
    this.name = 'AuthoringSnapshotError';
  }
}

const ENTRY_YAML = 'design.yaml';
const PAGE_YAML = 'pages/canvas.yaml';
const ROOT_FILES = new Set([ENTRY_YAML]);

function lstatOptional(path: string, label: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AuthoringSnapshotError(`collectAuthoring: lstat failed: ${label}: ${String(error)}`);
  }
}

/** 唯一 relpath 语法：design.yaml | media/<单段>。intake 与守护进程采集共用。 */
export function isAuthoringRelPath(rel: string): boolean {
  if (ROOT_FILES.has(rel)) return true;
  const media = /^media\/([^/]+)$/.exec(rel);
  if (media !== null && media[1] !== '.' && media[1] !== '..') return true;
  return false;
}

const posix = (p: string): string => p.split(sep).join('/');

type CollectionOptions = { referencedOnly?: boolean; onDependencies?: (paths: string[]) => void };

export function collectAuthoring(
  dir: string,
  options: CollectionOptions = {}
): Map<string, Uint8Array> {
  return scanAuthoring(dir, options);
}

/** @internal Explicit migration only; shares the same no-follow file guards. */
export function collectTwoFileArtwork(dir: string): Map<string, Uint8Array> {
  return scanAuthoring(dir, {}, undefined, true);
}

/** Exact full authoring digest, using the same guarded scan without retaining file bytes. */
export function digestAuthoring(dir: string): string {
  const hash = createHash('sha256');
  scanAuthoring(dir, {}, hash, true);
  return hash.digest('hex');
}

function scanAuthoring(
  dir: string,
  options: CollectionOptions,
  hash?: Hash,
  legacy = false
): Map<string, Uint8Array> {
  let totalBytes = 0;
  const chunk = hash ? new Uint8Array(64 * 1024) : undefined;
  options.onDependencies?.([ENTRY_YAML]);
  let rootStat;
  try {
    rootStat = lstatSync(dir);
  } catch (error) {
    throw new AuthoringSnapshotError(`collectAuthoring: dir unreadable: ${String(error)}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new AuthoringSnapshotError(
      'collectAuthoring: dir must be a real directory (not a symlink)'
    );
  }
  const rootReal = realpathSync(dir);
  const out = new Map<string, Uint8Array>();

  // mustExist=true：entry 来自 readdir 列表，随后 lstat ENOENT = 采集期文件被抽走（TOCTOU），拒。
  const takeFile = (rel: string, mustExist = false): void => {
    const abs = join(dir, rel);
    const st = lstatOptional(abs, rel);
    if (st === null) {
      if (mustExist) {
        throw new AuthoringSnapshotError(`collectAuthoring: lstat failed: ${rel}: ENOENT`);
      }
      return;
    }
    if (st.isSymbolicLink()) {
      throw new AuthoringSnapshotError(`collectAuthoring: symlink rejected: ${rel}`);
    }
    if (!st.isFile()) {
      throw new AuthoringSnapshotError(`collectAuthoring: not a regular file: ${rel}`);
    }
    if (st.nlink !== 1) {
      throw new AuthoringSnapshotError(
        `collectAuthoring: hardlink rejected: ${rel} (nlink=${st.nlink})`
      );
    }
    const real = realpathSync(abs);
    const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
    if (real !== rootReal && !real.startsWith(prefix)) {
      throw new AuthoringSnapshotError(`collectAuthoring: path escapes dir: ${rel}`);
    }
    if (options.referencedOnly) {
      const failure = rel.startsWith('media/') ? assetSizeFailure(rel, st.size) : undefined;
      if (failure) throw new AuthoringSnapshotError(describeAssetAdmissionFailure(failure), failure);
      if (st.size > MAX_ASSET_BYTES || totalBytes + st.size > 48 * 1024 * 1024)
        throw new AuthoringSnapshotError('authoring snapshot exceeds resource limit');
    }
    const fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      const same = (a: Stats, b: Stats) =>
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.ctimeMs === b.ctimeMs &&
        b.nlink === 1;
      if (!same(st, opened)) throw new AuthoringSnapshotError(`file changed while opening: ${rel}`);
      if (hash && chunk) {
        hash.update(posix(rel));
        hash.update('\0');
        hash.update(String(st.size));
        hash.update('\0');
        let offset = 0;
        while (offset < st.size) {
          const count = readSync(fd, chunk, 0, Math.min(chunk.length, st.size - offset), offset);
          if (count === 0) throw new AuthoringSnapshotError(`file shortened while reading: ${rel}`);
          hash.update(chunk.subarray(0, count));
          offset += count;
        }
        if (
          readSync(fd, chunk, 0, 1, offset) !== 0 ||
          !same(st, fstatSync(fd)) ||
          !same(st, lstatSync(abs))
        )
          throw new AuthoringSnapshotError(`file changed while reading: ${rel}`);
        // Keep only the path for the common required-entry check, never file bytes.
        out.set(posix(rel), new Uint8Array());
        return;
      }
      // Fixed-size reads also bound allocation if the file grows after lstat.
      const bytes = options.referencedOnly
        ? (() => {
            const buffer = new Uint8Array(st.size + 1);
            let offset = 0;
            while (offset < buffer.length) {
              const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
              if (count === 0) break;
              offset += count;
            }
            return buffer.slice(0, offset);
          })()
        : new Uint8Array(readFileSync(fd));
      if (bytes.length !== st.size || !same(st, fstatSync(fd)) || !same(st, lstatSync(abs)))
        throw new AuthoringSnapshotError(`file changed while reading: ${rel}`);
      totalBytes += bytes.length;
      out.set(posix(rel), bytes);
    } finally {
      closeSync(fd);
    }
  };

  for (const rootFile of ROOT_FILES) takeFile(rootFile);
  const leftoverPptd = lstatOptional(join(dir, 'design.pptd'), 'design.pptd');
  if (leftoverPptd !== null) {
    throw new AuthoringSnapshotError('leftover PPTD is not admitted (MOLLY-E-PPTD): design.pptd');
  }

  if (options.referencedOnly) {
    const parent = lstatOptional(join(dir, 'pages'), 'pages');
    if (parent?.isSymbolicLink()) throw new AuthoringSnapshotError('pages directory is redirected');
    if (parent?.isDirectory() && lstatOptional(join(dir, PAGE_YAML), PAGE_YAML))
      throw new AuthoringSnapshotError('old two-file YAML requires explicit migration');
  }

  if (options.referencedOnly) {
    assertAuthoringEntry(out.keys());
    const decode = (rel: string) =>
      parse(new TextDecoder().decode(out.get(rel)), { maxAliasCount: 100 });
    const project = decode(ENTRY_YAML) as ValidatedArtwork;
    const refs = listSemanticAssetRefs(project);
    for (const { ref } of refs) {
      if (
        typeof ref !== 'string' ||
        !ref.startsWith('media/') ||
        !isAuthoringRelPath(ref) ||
        ref.includes('\\')
      )
        throw new AuthoringSnapshotError('invalid referenced asset path');
    }
    options.onDependencies?.([
      ENTRY_YAML,
      ...new Set(refs.map(({ ref }) => ref)),
    ]);
    for (const { ref } of refs) {
      if (out.has(ref)) continue;
      const parent = lstatSync(join(dir, 'media'));
      if (parent.isSymbolicLink() || !parent.isDirectory())
        throw new AuthoringSnapshotError('media directory is redirected');
      takeFile(ref, true);
    }
    return out;
  }

  const takeDir = (subdir: string, accept: (name: string) => string | undefined): void => {
    const abs = join(dir, subdir);
    const st = lstatOptional(abs, subdir);
    if (st === null) return;
    if (st.isSymbolicLink()) {
      throw new AuthoringSnapshotError(`collectAuthoring: symlink rejected: ${subdir}`);
    }
    if (!st.isDirectory()) {
      throw new AuthoringSnapshotError(`collectAuthoring: not a directory: ${subdir}`);
    }
    const names = readdirSync(abs);
    if (hash) names.sort();
    for (const name of names) {
      const rel = accept(name);
      if (rel === undefined) {
        // 非 allowlist 入口：若是非普通文件（symlink/FIFO）仍须拒绝，不能静默跳过后门。
        const child = join(abs, name);
        const childSt = lstatSync(child);
        if (
          childSt.isSymbolicLink() ||
          childSt.isFIFO() ||
          childSt.isSocket() ||
          childSt.isCharacterDevice() ||
          childSt.isBlockDevice()
        ) {
          throw new AuthoringSnapshotError(
            `collectAuthoring: non-regular entry rejected: ${subdir}/${name}`
          );
        }
        if (childSt.isFile() && childSt.nlink !== 1) {
          throw new AuthoringSnapshotError(
            `collectAuthoring: hardlink rejected: ${subdir}/${name} (nlink=${childSt.nlink})`
          );
        }
        // `pages/..yaml` 解析为 name=`.`，语法已拒；不得当普通非 allowlist 静默跳过。
        const attempted = `${subdir}/${name}`;
        const component = (/^pages\/([^/]+)\.yaml$/.exec(attempted) ??
          /^media\/([^/]+)$/.exec(attempted))?.[1];
        if (component === '.') {
          throw new AuthoringSnapshotError(`collectAuthoring: relpath rejected: ${attempted}`);
        }
        if (subdir === 'pages' && childSt.isFile()) {
          throw new AuthoringSnapshotError(`extra page is not admitted: ${attempted}`);
        }
        continue;
      }
      takeFile(rel, true);
    }
  };

  // Digest order must match the existing sorted path/length/bytes encoding.
  // Preserve ordinary snapshot insertion order for existing consumers.
  for (const directory of hash ? ['media', 'pages'] : ['pages', 'media'])
    takeDir(directory, (name) =>
      isAuthoringRelPath(`${directory}/${name}`) || (legacy && `${directory}/${name}` === PAGE_YAML) ? `${directory}/${name}` : undefined
    );

  assertAuthoringEntry(out.keys());
  return out;
}

/** A collected authoring snapshot must contain exactly the design.yaml entry. */
export function assertAuthoringEntry(paths: Iterable<string>): void {
  const keys = new Set(paths);
  if (!keys.has(ENTRY_YAML))
    throw new AuthoringSnapshotError('authoring entry missing (design.yaml)');
}
