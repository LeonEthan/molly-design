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
  /* The imagegen skill instructs the agent to call `molly_generate_image`, so it
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
    const entryText = entry.replace(/\s+/g, ' ');
    expect(text).not.toMatch(
      /inspect → draft|inspect once|inspect in one pass|verify in two loops|never script pixel|do not write pixel-probing|rerun until|done check is executable|review is incomplete|never substitute another renderer/i
    );
    expect(graphicText).not.toMatch(
      /choose your own analysis|methods, order|order and iteration count|no fixed limit|sufficient supplied material supports proceeding directly/i
    );
    expect(Array.from(entry.matchAll(/^### (\d+)\./gm), (match) => Number(match[1]))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(entryText).toContain('Follow these nine stages and their dependencies.');
    expect(entryText).toContain('as Pinterest unless **all** of these conditions hold:');
    expect(entryText).toContain(
      'the user explicitly identifies a concrete template or reference target'
    );
    expect(entryText).toContain('following that target without additional design inspiration');
    expect(entryText).toContain('you have actually inspected the target');
    expect(entryText).toContain('the user has not also requested research');
    expect(entryText).toContain('Local edits and reconstruction use this same rule.');
    expect(entryText).toContain('final collection runs after your turn ends');
    expect(entryText).toContain('Backgrounds can remain opaque.');
    for (const [, target] of entry.matchAll(/\]\(([^)]+)\)/g)) {
      expect(existsSync(path.resolve(graphic, target.split('#')[0])), target).toBe(true);
    }
    expect(graphicText).toContain('references/layered-workflow.md');
    expect(text).toContain('actual image-reading tool');
    expect(text).toContain('molly_edit_image');
    expect(text).toContain('Molly has no default model');
    expect(text).toContain('sent as data URLs in a JSON request');
    expect(text).toContain('`background: "transparent"`');

    expect(graphicText).toContain('design.yaml');
    expect(graphicText).toContain('molly-canvas/1');
    expect(graphicText).toContain('media/');
    expect(graphicText).toContain('You may write `design.yaml` directly');
    expect(graphicText).toMatch(/\bid\b/);
    expect(graphicText).toMatch(/\bkind\b/);
    expect(graphicText).toContain(
      'If `molly_render_preview` is absent, only that tool is unavailable'
    );
    expect(graphicText).not.toMatch(/You may write `design\.pptd` directly/);
    expect(graphicText).not.toMatch(/version:\s*v[23]/);
    expect(graphicText).not.toMatch(/\belementId\b|\belementType\b/);
    expect(graphicText).not.toMatch(/\| Relationship \| Useful forms \|/);
    expect(graphicText).not.toMatch(/Time, stages, change/);
    expect(graphicText).not.toMatch(/Path, propagation, migration/);
    expect(graphicText).not.toMatch(/Process, mechanism, method/);
    expect(graphicText).not.toMatch(/few-shot/i);
    expect(graphicText).not.toMatch(/step0|Step 0|five-step/i);
    expect(graphicText).not.toMatch(/self-owned, licensed, officially citable/);
    expect(graphicText).not.toMatch(/Do not forge real (magazines|logos)/);
    expect(graphicText).not.toMatch(/crop lines and text[- ]safe areas/);
    expect(graphicText).not.toMatch(/Do not treat [“"]poster[”"] as a default portrait/);
    expect(graphicText).not.toMatch(/compose at one ratio then stretch/);
    expect(text).not.toMatch(/design\.pptd/);
    expect(text).not.toMatch(/use the result in PPTD/);

    // Directly authored final files are valid without running finalize, and the
    // shipped helper executes from the materialized tree with its bundled library.
    expect(existsSync(path.join(graphic, 'examples/minimal/design.yaml'))).toBe(true);
    expect(existsSync(path.join(graphic, 'examples/minimal/pages/canvas.yaml'))).toBe(false);
    expect(existsSync(path.join(graphic, 'examples/minimal/poster.pptd'))).toBe(false);
    expect(existsSync(path.join(graphic, 'examples/minimal/pages/poster.page'))).toBe(false);
    cpSync(path.join(graphic, 'examples/minimal'), workdir, { recursive: true });
    const intake = spawnSync(
      process.execPath,
      [path.join(graphic, 'scripts/render-preview.mjs'), path.join(workdir, 'design.yaml')],
      { cwd: workdir, encoding: 'utf8' }
    );
    expect(intake.status, intake.stderr).toBe(0);
    expect(intake.stdout).toContain('intake OK');
    expect(intake.stdout).toContain('This script does not render or review images');
    expect(intake.stdout).toContain('molly_render_preview');
    expect(readdirSync(workdir)).not.toContain('design.yaml.tmp');

    const edited = path.join(workdir, '.claude/skills/graphic-design/SKILL.md');
    writeFileSync(edited, '# Human-owned design instructions\n');
    const second = materializeDesignSkills({ workdir, sourceDir, skills });
    expect(second.sourceIdentity).toBe(first.sourceIdentity);
    expect(second.targets.find((target) => target.dir === path.dirname(edited))?.drifted).toEqual([
      'SKILL.md',
    ]);
    expect(readFileSync(edited, 'utf8')).toBe('# Human-owned design instructions\n');
    expect(readFileSync(path.join(graphic, 'SKILL.md'), 'utf8')).toContain(
      'Follow these nine stages and their dependencies.'
    );
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
