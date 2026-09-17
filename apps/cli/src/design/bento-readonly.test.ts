import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

it('the shipped Bento bridge rejects command, undo and redo mutations while read-only', async () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const vendor = path.join(root, 'packages/design-bento/vendor/packages');
  const compiled = await build({
    entryPoints: [path.join(vendor, 'editor-bento/src/bridge.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    alias: {
      kernel: path.join(vendor, 'kernel/src/kernel.ts'),
      contracts: path.join(vendor, 'contracts/src/index.ts'),
    },
  });
  const output = compiled.outputFiles[0];
  if (!output) throw Error('Missing bridge bundle');
  const exported = (await import(
    'data:text/javascript;base64,' + Buffer.from(output.text).toString('base64')
  )) as {
    createRecordingVisualDocumentKernel(doc: unknown): unknown;
    BentoVisualBridge: new (
      kernel: unknown,
      refresh: () => void
    ) => {
      setReadonly(value: boolean): void;
      snapshot(): string;
      dispatch(commands: unknown[]): { ok: boolean };
      undo(): { ok: boolean };
      redo(): { ok: boolean };
    };
  };
  const sample = JSON.parse(
    await readFile(path.join(root, 'packages/design-bento/sample.json'), 'utf8')
  );
  const bridge = new exported.BentoVisualBridge(
    exported.createRecordingVisualDocumentKernel(sample.doc),
    () => {}
  );
  expect(bridge.dispatch([{ type: 'setCanvasSize', width: 1000, height: 800 }])).toMatchObject({
    ok: true,
  });
  const edited = bridge.snapshot();
  bridge.setReadonly(true);
  expect(bridge.dispatch([{ type: 'setCanvasSize', width: 600, height: 400 }]).ok).toBe(false);
  expect(bridge.undo().ok).toBe(false);
  expect(bridge.redo().ok).toBe(false);
  expect(bridge.snapshot()).toBe(edited);
  bridge.setReadonly(false);
  expect(bridge.undo().ok).toBe(true);
  expect(bridge.snapshot()).not.toBe(edited);
  expect(bridge.redo().ok).toBe(true);
  expect(bridge.snapshot()).toBe(edited);
});
