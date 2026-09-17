/**
 * Design skill materializer (P2.1).
 *
 * Syncs the bundled design skill directories (`design-skills/` next to the CLI
 * entry, staged by scripts/copy-design-skills.js) into a design session's
 * workdir project-level skill dirs:
 *
 *   <workdir>/.claude/skills/<skill>/
 *   <workdir>/.agents/skills/<skill>/
 *
 * Each materialized directory carries `.molly-managed-files.json`
 * (relpath → sha256). Sync discipline (agent-naive; the workdir is user space):
 *
 * - Only files whose bytes differ are written, and only when the existing file
 *   is still managed-clean (its current hash matches what we previously wrote)
 *   or absent. A file the user modified is never overwritten; it is reported in
 *   `drifted`.
 * - Files absent from the new bundle but present from before are left alone.
 * - Home directories are never touched: writes are confined to the supplied
 *   workdir, existing symlinked target dirs are refused, and resolved paths are
 *   containment-checked.
 */

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESIGN_SKILL_TARGET_BASES = ['.claude/skills', '.agents/skills'] as const;
export const SKILL_MANIFEST_FILENAME = '.molly-managed-files.json';

/** Skills every design session gets, capability or not. */
export const DEFAULT_DESIGN_SKILLS = ['graphic-design'] as const;

/**
 * The skill that only makes sense next to `molly_generate_image` and `molly_edit_image`.
 *
 * Delivered exactly when the tool is: this function is only ever reached for a
 * session whose meta carries `design` (see `prepareDesignTurn`), the machine
 * part of the gate is the same `isImageConnectionReady` answer, and the tool
 * gate applies the same design-session rule, so the agent never reads
 * instructions for a tool it does not have, and never holds the tool without
 * the method that says how to use it. The skill's own SKILL.md also covers the
 * one window this cannot close — a connection switched off after
 * materialization — so a stale copy still gives an honest answer instead of a
 * dead tool call.
 */
export const IMAGE_DESIGN_SKILL = 'imagegen';

/** The skills to materialize for a session with this image capability. */
export const designSkillsForImageCapability = (hasImageCapability: boolean): string[] =>
  hasImageCapability ? [...DEFAULT_DESIGN_SKILLS, IMAGE_DESIGN_SKILL] : [...DEFAULT_DESIGN_SKILLS];

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export class SkillMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillMaterializationError';
  }
}

export interface SkillTargetResult {
  /** Absolute path of the materialized skill directory. */
  dir: string;
  /** Files written this run (paths relative to the skill dir). */
  written: string[];
  /** Files already byte-identical (not rewritten). */
  unchanged: string[];
  /** Files the user modified (or pre-existing unmanaged files): not touched. */
  drifted: string[];
}

export interface SkillMaterializationResult {
  skills: string[];
  targets: SkillTargetResult[];
  /**
   * sha256 over the sorted (skill, relpath, sha256) tuples of everything this
   * run manages — the content identity of the delivered skill material, for
   * later turn-input manifests (P2.2).
   */
  sourceIdentity: string;
}

/** Resolve the staged `design-skills/` directory in dev and packaged layouts. */
export function resolveBundledSkillSourceDir(argv1: string = process.argv[1] ?? ''): string {
  const importDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    argv1 ? path.join(path.dirname(path.resolve(argv1)), 'design-skills') : '',
    path.join(importDir, 'design-skills'),
    path.join(importDir, '..', 'design-skills'),
  ];
  for (const candidate of candidates) {
    if (candidate !== '' && existsSyncDir(candidate)) return candidate;
  }
  throw new SkillMaterializationError(
    `bundled design-skills directory not found (looked in: ${candidates.filter(Boolean).join(', ')})`
  );
}

function existsSyncDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function listSourceFiles(sourceDir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (rel: string): void => {
    const abs = path.join(sourceDir, rel);
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(path.join(sourceDir, childRel));
      if (st.isDirectory()) {
        walk(childRel);
      } else if (st.isFile()) {
        files.set(childRel, readFileSync(path.join(sourceDir, childRel)));
      } else {
        throw new SkillMaterializationError(
          `bundled skill source has a non-regular entry: ${childRel}`
        );
      }
    }
  };
  walk('');
  return files;
}

function readManifest(dir: string): Map<string, string> {
  try {
    let bytes: string;
    try {
      bytes = readFileSync(path.join(dir, SKILL_MANIFEST_FILENAME), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Only an absent new manifest permits legacy ownership. A new manifest's
      // missing entries may represent user edits; never resurrect them from old data.
      bytes = readFileSync(path.join(dir, '.folio-managed-files.json'), 'utf8');
    }
    const raw = JSON.parse(bytes) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return new Map();
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) out.set(key, value);
    }
    return out;
  } catch {
    return new Map();
  }
}

function syncSkillDir(sourceFiles: Map<string, Buffer>, targetDir: string): SkillTargetResult {
  const result: SkillTargetResult = { dir: targetDir, written: [], unchanged: [], drifted: [] };

  if (existsSyncSymlink(targetDir)) {
    throw new SkillMaterializationError(
      `refusing to write through symlinked skill dir: ${targetDir}`
    );
  }

  const previous = readManifest(targetDir);
  const nextManifest: Record<string, string> = {};

  for (const [rel, bytes] of [...sourceFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hash = sha256Hex(bytes);
    nextManifest[rel] = hash;
    const dest = path.join(targetDir, ...rel.split('/'));
    let existing: Buffer | null = null;
    try {
      const st = lstatSync(dest);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new SkillMaterializationError(`refusing non-regular skill file target: ${dest}`);
      }
      existing = readFileSync(dest);
    } catch (error) {
      if (error instanceof SkillMaterializationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing !== null) {
      const currentHash = sha256Hex(existing);
      if (currentHash === hash) {
        result.unchanged.push(rel);
        continue;
      }
      const managedHash = previous.get(rel);
      if (managedHash === undefined || managedHash !== currentHash) {
        // Never present in our manifest, or user-modified since we wrote it.
        result.drifted.push(rel);
        // Keep the managed manifest honest: a drifted file is no longer ours.
        delete nextManifest[rel];
        continue;
      }
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    result.written.push(rel);
  }

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    path.join(targetDir, SKILL_MANIFEST_FILENAME),
    `${JSON.stringify(nextManifest, null, 2)}\n`
  );
  return result;
}

function existsSyncSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface MaterializeDesignSkillsOptions {
  /** Absolute session workdir (e.g. getDefaultSessionWorkdir(sessionId)). */
  workdir: string;
  /** Skills to materialize; defaults to graphic-design only. */
  skills?: readonly string[];
  /** Test seam: explicit bundled skill source dir. */
  sourceDir?: string;
}

export function materializeDesignSkills(
  opts: MaterializeDesignSkillsOptions
): SkillMaterializationResult {
  const workdir = path.resolve(opts.workdir);
  const sourceRoot = opts.sourceDir ?? resolveBundledSkillSourceDir();
  const skills = opts.skills ?? DEFAULT_DESIGN_SKILLS;

  const identityHash = createHash('sha256');
  const targets: SkillTargetResult[] = [];
  // Containment is checked on resolved (not real) paths: symlinked target
  // dirs are refused separately in syncSkillDir, and macOS realpaths like
  // /tmp -> /private/tmp must not false-positive here.
  const resolvedWorkdir = path.resolve(workdir);

  for (const skill of skills) {
    if (!SKILL_NAME_RE.test(skill)) {
      throw new SkillMaterializationError(`invalid skill name: ${JSON.stringify(skill)}`);
    }
    const sourceDir = path.join(sourceRoot, skill);
    if (!existsSyncDir(sourceDir)) {
      throw new SkillMaterializationError(
        `bundled skill not found: ${skill} (under ${sourceRoot})`
      );
    }
    const sourceFiles = listSourceFiles(sourceDir);
    for (const [rel, bytes] of [...sourceFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      identityHash.update(`${skill}/${rel}\0${sha256Hex(bytes)}\0`);
    }
    for (const base of DESIGN_SKILL_TARGET_BASES) {
      const targetDir = path.join(workdir, base, skill);
      const resolvedTarget = path.resolve(targetDir);
      if (!isWithin(resolvedWorkdir, resolvedTarget)) {
        throw new SkillMaterializationError(`skill target escapes the workdir: ${resolvedTarget}`);
      }
      targets.push(syncSkillDir(sourceFiles, targetDir));
    }
  }

  return { skills: [...skills], targets, sourceIdentity: identityHash.digest('hex') };
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Prompt pointer line for design turns (see message-handler wiring). */
export function designSkillPointerLine(workdir: string, skill = 'graphic-design'): string {
  const skillDir = path.join(path.resolve(workdir), '.claude', 'skills', skill);
  return `Design format and optional helpers: ${skillDir}/SKILL.md. Choose your own creative methods and review.`;
}
