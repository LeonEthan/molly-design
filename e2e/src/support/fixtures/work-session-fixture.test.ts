import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { WorkSessionFixture } from './work-session-fixture.js';

void test('keeps the lifecycle fixture clean for helpers but exposes authored design files', async () => {
  const fixture = await WorkSessionFixture.create();
  try {
    const write = (relativePath: string) => {
      const file = join(fixture.projectRoot, relativePath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'synthetic fixture\n');
    };
    write('.agents/skills/graphic-design/SKILL.md');
    write('.claude/skills/graphic-design/.folio-managed-files.json');
    const authoredFiles = [
      '.agents/skills/custom/SKILL.md',
      '.folio/artworks/artwork/session/design.pptd',
      '.folio/artworks/artwork/session/media/source.png',
      'design.pptd',
    ];
    for (const file of authoredFiles) write(file);
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: fixture.projectRoot,
      encoding: 'utf8',
    });
    assert.deepEqual(status.trimEnd().split('\n'), authoredFiles.map((file) => `?? ${file}`));
  } finally {
    fixture.dispose();
  }
});
