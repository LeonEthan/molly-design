/**
 * Design skill sync discipline and actual packaged/materialized Agent materials.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SKILL_TARGET_BASES,
  SKILL_MANIFEST_FILENAME,
  SkillMaterializationError,
  designSkillPointerLine,
  designSkillsForImageCapability,
  materializeDesignSkills,
  resolveBundledSkillSourceDir,
} from './skills';
import { rmSync } from 'node:fs';

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const workdirs: string[] = [];
afterEach(() => {
  while (workdirs.length > 0) rmSync(workdirs.pop()!, { recursive: true, force: true });
});

function makeSource(skillFiles: Record<string, string>, skill = 'graphic-design'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'molly-skill-src-'));
  workdirs.push(root);
  const dir = path.join(root, skill);
  for (const [rel, content] of Object.entries(skillFiles)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function makeWorkdir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'molly-skill-dst-'));
  workdirs.push(dir);
  return dir;
}

const SOURCE_FILES = {
  'SKILL.md': '# test skill\n',
  'references/guide.md': 'guide v1\n',
  'scripts/finalize.mjs': '// finalize v1\n',
};

describe('materializeDesignSkills', () => {
  it('syncs every bundled file into both project-level skill dirs with a sha256 manifest', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    const result = materializeDesignSkills({ workdir, sourceDir });

    expect(result.skills).toEqual(['graphic-design']);
    expect(result.targets).toHaveLength(2);
    expect(result.sourceIdentity).toMatch(/^[0-9a-f]{64}$/);

    for (const base of DESIGN_SKILL_TARGET_BASES) {
      const dir = path.join(workdir, base, 'graphic-design');
      for (const [rel, content] of Object.entries(SOURCE_FILES)) {
        expect(readFileSync(path.join(dir, rel), 'utf8')).toBe(content);
      }
      const manifest = JSON.parse(
        readFileSync(path.join(dir, SKILL_MANIFEST_FILENAME), 'utf8')
      ) as Record<string, string>;
      expect(Object.keys(manifest).sort()).toEqual(Object.keys(SOURCE_FILES).sort());
      for (const [rel, hash] of Object.entries(manifest)) {
        expect(hash).toBe(sha256Hex(readFileSync(path.join(dir, rel))));
      }
    }
  });

  it('is idempotent: a second run writes nothing and reports all files unchanged', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    materializeDesignSkills({ workdir, sourceDir });
    const second = materializeDesignSkills({ workdir, sourceDir });
    for (const target of second.targets) {
      expect(target.written).toEqual([]);
      expect(target.drifted).toEqual([]);
      expect(target.unchanged.sort()).toEqual(Object.keys(SOURCE_FILES).sort());
    }
    expect(second.sourceIdentity).toBe(
      materializeDesignSkills({ workdir, sourceDir }).sourceIdentity
    );
  });

  it('updates a managed-clean file when the bundle changes, and rewrites the manifest', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    materializeDesignSkills({ workdir, sourceDir });

    writeFileSync(path.join(sourceDir, 'graphic-design', 'references', 'guide.md'), 'guide v2\n');
    const result = materializeDesignSkills({ workdir, sourceDir });
    for (const target of result.targets) {
      expect(target.written).toEqual(['references/guide.md']);
      expect(target.drifted).toEqual([]);
      expect(readFileSync(path.join(target.dir, 'references', 'guide.md'), 'utf8')).toBe(
        'guide v2\n'
      );
    }
  });

  it('never overwrites a user-modified file and reports the drift', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    materializeDesignSkills({ workdir, sourceDir });

    const edited = path.join(workdir, '.claude', 'skills', 'graphic-design', 'SKILL.md');
    writeFileSync(edited, '# user edits\n');
    // The bundle moved on too, so the file differs from both old and new.
    writeFileSync(path.join(sourceDir, 'graphic-design', 'SKILL.md'), '# test skill v2\n');

    const result = materializeDesignSkills({ workdir, sourceDir });
    const claude = result.targets.find((t) => t.dir.includes('.claude'))!;
    const agents = result.targets.find((t) => t.dir.includes('.agents'))!;
    expect(claude.drifted).toEqual(['SKILL.md']);
    expect(readFileSync(edited, 'utf8')).toBe('# user edits\n');
    // The untouched .agents copy updated normally.
    expect(agents.drifted).toEqual([]);
    expect(readFileSync(path.join(agents.dir, 'SKILL.md'), 'utf8')).toBe('# test skill v2\n');
    // Drift is sticky: still reported, still not clobbered on the next run.
    const third = materializeDesignSkills({ workdir, sourceDir });
    expect(third.targets.find((t) => t.dir.includes('.claude'))!.drifted).toEqual(['SKILL.md']);
    expect(readFileSync(edited, 'utf8')).toBe('# user edits\n');
  });

  it('never overwrites a pre-existing unmanaged file', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    const preExisting = path.join(workdir, '.claude', 'skills', 'graphic-design', 'SKILL.md');
    mkdirSync(path.dirname(preExisting), { recursive: true });
    writeFileSync(preExisting, '# my own skill\n');

    const result = materializeDesignSkills({ workdir, sourceDir });
    const claude = result.targets.find((t) => t.dir.includes('.claude'))!;
    expect(claude.drifted).toEqual(['SKILL.md']);
    expect(readFileSync(preExisting, 'utf8')).toBe('# my own skill\n');
  });

  it('refuses skill names that escape the target layout', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    expect(() => materializeDesignSkills({ workdir, sourceDir, skills: ['../evil'] })).toThrow(
      SkillMaterializationError
    );
    expect(existsSync(path.join(workdir, '.claude', 'evil'))).toBe(false);
  });

  it('refuses to write through a symlinked target dir', () => {
    const sourceDir = makeSource(SOURCE_FILES);
    const workdir = makeWorkdir();
    const elsewhere = makeWorkdir();
    const link = path.join(workdir, '.claude', 'skills', 'graphic-design');
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(elsewhere, link);
    expect(() => materializeDesignSkills({ workdir, sourceDir })).toThrow(
      SkillMaterializationError
    );
    expect(existsSync(path.join(elsewhere, 'SKILL.md'))).toBe(false);
  });

  it('fails honestly when the bundled source is missing', () => {
    const workdir = makeWorkdir();
    const missing = path.join(makeWorkdir(), 'no-such-dir');
    expect(() => materializeDesignSkills({ workdir, sourceDir: missing })).toThrow(
      SkillMaterializationError
    );
  });
});

describe('designSkillPointerLine', () => {
  it('points at the .claude project skill dir', () => {
    expect(designSkillPointerLine('/tmp/wd')).toContain(
      '/tmp/wd/.claude/skills/graphic-design/SKILL.md'
    );
  });
});

describe('designSkillsForImageCapability', () => {
  /* The imagegen skill instructs the agent to call the `molly_image` tools, so it
     is delivered exactly when that tool will be registered — never on its own. */
  it('adds the imagegen skill only when the machine has image capability', () => {
    expect(designSkillsForImageCapability(false)).toEqual(['graphic-design']);
    expect(designSkillsForImageCapability(true)).toEqual(['graphic-design', 'imagegen']);
  });

  it('materializes both skills from the bundle when capability is present', () => {
    const root = makeSource(SOURCE_FILES);
    const imagegenDir = path.join(root, 'imagegen');
    mkdirSync(imagegenDir, { recursive: true });
    writeFileSync(path.join(imagegenDir, 'SKILL.md'), '# imagegen\n');
    const workdir = makeWorkdir();
    const result = materializeDesignSkills({
      workdir,
      sourceDir: root,
      skills: designSkillsForImageCapability(true),
    });

    expect(result.skills).toEqual(['graphic-design', 'imagegen']);
    for (const base of DESIGN_SKILL_TARGET_BASES) {
      expect(existsSync(path.join(workdir, base, 'imagegen', 'SKILL.md'))).toBe(true);
    }
  });
});

function materializedMarkdown(skillDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.set(full, readFileSync(full, 'utf8'));
    }
  };
  walk(skillDir);
  return files;
}

function headingSlugs(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^#{1,6} (.+)$/gm), ([, title]) =>
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-')
  );
}

describe('packaged design materials', () => {
  it('stages the real bundle, materializes both skills, and keeps human edits', () => {
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const staged = makeWorkdir();
    for (const [script, args] of [
      ['packages/design-authoring/scripts/build.mjs', []],
      ['apps/cli/scripts/copy-design-skills.js', [staged]],
    ] as const) {
      const result = spawnSync(process.execPath, [path.join(repository, script), ...args], {
        cwd: repository,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
    }
    const sourceDir = resolveBundledSkillSourceDir(path.join(staged, 'index.js'));
    const workdir = makeWorkdir();
    const skills = designSkillsForImageCapability(true);
    const first = materializeDesignSkills({ workdir, sourceDir, skills });
    const materials: string[] = [];
    const graphicMaterials: string[] = [];
    for (const target of first.targets) {
      const manifest = JSON.parse(
        readFileSync(path.join(target.dir, SKILL_MANIFEST_FILENAME), 'utf8')
      ) as Record<string, string>;
      for (const rel of Object.keys(manifest)) {
        const bytes = readFileSync(path.join(target.dir, rel));
        expect(sha256Hex(bytes)).toBe(manifest[rel]);
        expect(
          bytes.equals(readFileSync(path.join(sourceDir, path.basename(target.dir), rel)))
        ).toBe(true);
        if (rel.endsWith('.md')) {
          const text = bytes.toString('utf8');
          materials.push(text);
          if (path.basename(target.dir) === 'graphic-design') graphicMaterials.push(text);
        }
      }
    }
    const text = materials.join('\n');
    const graphicText = graphicMaterials.join('\n');
    const graphic = path.join(workdir, '.agents/skills/graphic-design');
    const entry = readFileSync(path.join(graphic, 'SKILL.md'), 'utf8');
    expect(text).not.toMatch(
      /inspect → draft|inspect once|inspect in one pass|verify in two loops|never script pixel|do not write pixel-probing|rerun until|done check is executable|review is incomplete|never substitute another renderer/i
    );
    expect(graphicText).not.toMatch(
      /choose your own analysis|methods, order|order and iteration count|no fixed limit|sufficient supplied material supports proceeding directly/i
    );
    expect(Array.from(entry.matchAll(/^### (\d+)\./gm), (match) => Number(match[1]))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    for (const heading of ['Required workflow', 'Design defaults', 'Reporting']) {
      expect(entry).toMatch(new RegExp(`^## ${heading}$`, 'm'));
    }

    const graphicFiles = materializedMarkdown(graphic);
    const linked = new Set<string>();
    for (const [file, body] of graphicFiles) {
      for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^([a-z]+:|\/)/.test(target)) continue;
        const [relative, anchor] = target.split('#');
        const resolved = relative ? path.resolve(path.dirname(file), relative) : file;
        expect(existsSync(resolved), `${file} -> ${target}`).toBe(true);
        linked.add(resolved);
        if (anchor) {
          expect(headingSlugs(readFileSync(resolved, 'utf8')), `${file} -> ${target}`).toContain(
            anchor
          );
        }
      }
    }
    for (const file of graphicFiles.keys()) {
      if (file !== path.join(graphic, 'SKILL.md')) expect(linked, file).toContain(file);
    }
    for (const example of ['minimal', 'layered']) {
      expect(linked).toContain(path.join(graphic, 'examples', example, 'design.yaml'));
    }

    const singleOwner = [
      /\*\*Research rule\.\*\*/g,
      /^## Reporting$/gm,
      /^## Design defaults$/gm,
      /If `molly_render_preview` is absent/g,
      /Markdown image syntax/g,
      /^## What is editable today$/gm,
    ];
    const oneCopy = [...graphicFiles.values()].join('\n');
    for (const pattern of singleOwner) {
      expect(oneCopy.match(pattern)?.length ?? 0, String(pattern)).toBe(1);
    }

    expect(text).toContain('mcp__molly_image__generate');
    expect(text).toContain('Molly has no default model');
    expect(text).toContain('sent as data URLs in a JSON request');
    expect(text).toContain('`background: "transparent"`');
    expect(graphicText).not.toMatch(/You may write `design\.pptd` directly/);
    expect(graphicText).not.toMatch(/version:\s*v[23]/);
    expect(graphicText).not.toMatch(/\belementId\b|\belementType\b/);
    expect(graphicText).not.toMatch(/few-shot/i);
    expect(graphicText).not.toMatch(/step0|Step 0|five-step/i);
    expect(graphicText).not.toMatch(/do not claim native icons, tables, charts/i);
    expect(text).not.toMatch(/design\.pptd/);
    expect(text).not.toMatch(/use the result in PPTD/);

    // Directly authored final files are valid without running finalize, and the
    // shipped helper executes from the materialized tree with its bundled library.
    expect(existsSync(path.join(graphic, 'examples/minimal/pages/canvas.yaml'))).toBe(false);
    expect(existsSync(path.join(graphic, 'examples/minimal/poster.pptd'))).toBe(false);
    expect(existsSync(path.join(graphic, 'examples/minimal/pages/poster.page'))).toBe(false);
    for (const example of ['minimal', 'layered']) {
      const project = makeWorkdir();
      cpSync(path.join(graphic, 'examples', example), project, { recursive: true });
      const intake = spawnSync(
        process.execPath,
        [path.join(graphic, 'scripts/render-preview.mjs'), path.join(project, 'design.yaml')],
        { cwd: project, encoding: 'utf8' }
      );
      expect(intake.status, intake.stderr).toBe(0);
      expect(intake.stdout).toContain('intake OK');
      expect(intake.stdout).toContain('This script does not render or review images');
      expect(readdirSync(project)).not.toContain('design.yaml.tmp');
    }

    const edited = path.join(workdir, '.claude/skills/graphic-design/SKILL.md');
    writeFileSync(edited, '# Human-owned design instructions\n');
    const second = materializeDesignSkills({ workdir, sourceDir, skills });
    expect(second.sourceIdentity).toBe(first.sourceIdentity);
    expect(second.targets.find((target) => target.dir === path.dirname(edited))?.drifted).toEqual([
      'SKILL.md',
    ]);
    expect(readFileSync(edited, 'utf8')).toBe('# Human-owned design instructions\n');
    expect(readFileSync(path.join(graphic, 'SKILL.md'), 'utf8')).toMatch(/^## Required workflow$/m);
  });
});

it('upgrades Folio-managed skills while retaining user edits and old ownership evidence', () => {
  const sourceDir = makeSource(SOURCE_FILES);
  const workdir = makeWorkdir();
  materializeDesignSkills({ workdir, sourceDir });
  for (const base of DESIGN_SKILL_TARGET_BASES) {
    const dir = path.join(workdir, base, 'graphic-design');
    writeFileSync(
      path.join(dir, '.folio-managed-files.json'),
      readFileSync(path.join(dir, SKILL_MANIFEST_FILENAME))
    );
    rmSync(path.join(dir, SKILL_MANIFEST_FILENAME));
    writeFileSync(path.join(dir, 'references/guide.md'), 'user revision');
  }
  writeFileSync(path.join(sourceDir, 'graphic-design/SKILL.md'), '# upgraded skill');
  const result = materializeDesignSkills({ workdir, sourceDir });
  for (const target of result.targets) {
    expect(readFileSync(path.join(target.dir, 'SKILL.md'), 'utf8')).toBe('# upgraded skill');
    expect(readFileSync(path.join(target.dir, 'references/guide.md'), 'utf8')).toBe(
      'user revision'
    );
    expect(target.drifted).toContain('references/guide.md');
    expect(existsSync(path.join(target.dir, '.folio-managed-files.json'))).toBe(true);
  }
  // A new ownership manifest must not inherit entries intentionally dropped after drift.
  for (const target of result.targets)
    writeFileSync(
      path.join(target.dir, 'references/guide.md'),
      SOURCE_FILES['references/guide.md']
    );
  writeFileSync(path.join(sourceDir, 'graphic-design/references/guide.md'), 'new bundled guide');
  const again = materializeDesignSkills({ workdir, sourceDir });
  for (const target of again.targets) expect(target.drifted).toContain('references/guide.md');
});
