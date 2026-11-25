import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compare,
  compareScales,
  decodePng,
  fixtures,
  verifyTruncatedShadow,
} from './bench-g3-pixel-diff.mjs';

const cli = createRequire(new URL('../apps/cli/package.json', import.meta.url));
const { tsImport } = cli('tsx/esm/api');
const { acceptsDesignContent, designInput, designAssociation } = await tsImport(
  '../apps/cli/src/design/store.ts',
  import.meta.url
);
const saved = designInput.extend({ association: designAssociation });
const load = (name) =>
  JSON.parse(readFileSync(new URL('./g3-fixtures/' + name + '.json', import.meta.url)));
const blank = (width, height) => ({ width, height, data: Buffer.alloc(width * height * 4) });
for (const [index, name] of fixtures.entries())
  test(name + ' passes the saved design schema', () => {
    const { doc, assets } = saved.parse(load(name));
    assert(acceptsDesignContent({ doc, assets }));
    assert.deepEqual(
      doc.canvas,
      index === 0 ? { width: 800, height: 600 } : { width: 3000, height: 2000 }
    );
    for (const value of Object.values(assets)) assert.match(value, /^data:/);
    if (index === 1) {
      const image = doc.elements.find((el) => el.kind === 'image' && el.crop);
      const [x, y, w, h] = image.bounds;
      assert(x < 1536 && x + w > 1536 && y < 1536 && y + h > 1536);
      assert.match(assets[image.src.slice(6)], /^data:image\/png;base64,/);
      assert(doc.elements.some((el) => el.kind === 'image' && !el.crop));
    }
    if (index === 2) {
      const caster = doc.elements.find((el) => el.shadow);
      const [x, , width] = caster.bounds;
      assert(caster.shadow.blur * 2.5 >= 180);
      assert(x + width <= 1536 && x + width + caster.shadow.blur > 1536);
    }
  });

test('identical decoded PNG passes both sampling gates with provenance', async () => {
  const png = await cli('sharp')({
    create: { width: 64, height: 64, channels: 4, background: '#16879980' },
  })
    .png()
    .toBuffer();
  const image = await decodePng(png);
  const result = await compareScales(image, image, {
    captureDPR: 2,
    targetScale: 2,
    hostNativeDPR: 2,
  });
  assert(result.passed);
  assert.deepEqual(
    [
      result.direct.hostNativeDPR,
      result.direct.captureDPR,
      result.direct.targetScale,
      result.direct.resamplingMode,
    ],
    [2, 2, 2, 'direct-1to1']
  );
  assert.deepEqual(
    [result.area.width, result.area.targetScale, result.area.resamplingMode],
    [32, 1, 'area-resampled']
  );
});
for (const [name, channel, value] of [
  ['RGB', 0, 7],
  ['alpha', 3, 1],
])
  test(name + ' whole-image gate rejects excess error', () => {
    const ref = blank(64, 64),
      cand = blank(64, 64);
    for (let i = channel; i < cand.data.length; i += 4) cand.data[i] = value;
    assert.equal(compare(ref, cand).passed, false);
  });
for (const vertical of [true, false])
  test(
    'isolated discontinuity across ' + (vertical ? 'x' : 'y') + '=1536 fails the local gate',
    () => {
      const ref = vertical ? blank(3000, 96) : blank(96, 2000),
        cand = blank(ref.width, ref.height);
      for (let p = 41; p < 73; p++)
        cand.data[4 * (vertical ? p * ref.width + 1536 : 1536 * ref.width + p)] = 16;
      const report = compare(ref, cand);
      assert(report.rgbMAE < 0.5 / 255);
      assert.equal(report.seamMax, 2 / 255);
      assert.equal(report.worstWindow.start, 41);
      assert.equal(report.passed, false);
    }
  );

test('heavy shadow with zero input padding fails against a full-canvas convolution', async () => {
  const result = await verifyTruncatedShadow();
  assert(result.passed);
  assert(result.mutation.rgbMAE < 0.5 / 255);
  assert.equal(result.mutation.worstWindow.axis, 'x');
  assert.equal(result.mutation.worstWindow.seam, 1536);
});
