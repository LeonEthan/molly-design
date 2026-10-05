import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import fileIndexScanWorker from './file-index-scan-worker';

const execFileAsync = promisify(execFile);

for (const gitWorkspace of [false, true]) {
  describe(`fileIndexScanWorker ${gitWorkspace ? 'Git' : 'plain'} workspace`, () => {
    it('builds Files state without deriving changes from modified or new content', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'molly-file-index-worker-'));
      try {
        await mkdir(path.join(workspaceRoot, 'src'));
        await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'one\n');
        if (gitWorkspace) {
          await execFileAsync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: workspaceRoot });
          await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
          await execFileAsync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'initial'], { cwd: workspaceRoot });
        }
        await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'one\ntwo\n');
        await writeFile(path.join(workspaceRoot, 'src', 'new.ts'), 'new\n');
        const result = await fileIndexScanWorker({ kind: 'full-state', workspaceRoot, maxRawTextBytes: 1024, entryBudget: 1000 });
        expect(result.kind).toBe('full-state');
        if (result.kind !== 'full-state') throw new Error('Expected full Files state');
        expect(result.status).toBe('ok');
        expect(result.fileTreeEntries).toContainEqual(['src', { kind: 'lazy' }]);
        expect(result.fileIndex['src/app.ts']).toBe(true);
        expect(result.fileIndex['src/new.ts']).toBe(true);
        expect(result.pathCount).toBe(Object.keys(result.fileIndex).length);
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    });
  });
}
