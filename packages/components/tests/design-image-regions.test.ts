// @vitest-environment jsdom
import { expect, it } from 'vitest';
import {
  drawNoteRegions,
  regionCorners,
  regionFromPoints,
  toImage,
  toScreen,
  type ImageGeometry,
} from '../../design-bento/src/image-regions';

const geometry: ImageGeometry = {
  node: document.createElement('div'),
  source: 'asset.png',
  matrix: { a: 400, b: 0, c: 0, d: 200, e: 100, f: 200 },
};

it('normalizes a drag in any direction into one box', () => {
  expect(regionFromPoints([0.6, 0.8], [0.1, 0.2])).toEqual({
    from: [0.1, 0.2],
    to: [0.6, 0.8],
  });
});

it('lists a box as its four corners in order', () => {
  expect(regionCorners({ from: [0.1, 0.2], to: [0.6, 0.8] })).toEqual([
    [0.1, 0.2],
    [0.6, 0.2],
    [0.6, 0.8],
    [0.1, 0.8],
  ]);
});

it('maps screen points into image coordinates and back', () => {
  expect(toImage(geometry, 300, 350)).toEqual([0.5, 0.75]);
  expect(toScreen(geometry, [0.5, 0.75])).toEqual([300, 350]);
});

it('clamps points dragged past the image edge', () => {
  expect(toImage(geometry, 50, 900)).toEqual([0, 1]);
});

it('numbers each region with its note badge on the marked copy', () => {
  const texts: string[] = [];
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    stroke() {},
    fill() {},
    fillText(text: string) {
      texts.push(text);
    },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;
  drawNoteRegions(
    context,
    [
      { badge: 2, region: { from: [0.1, 0.2], to: [0.6, 0.8] } },
      { badge: 5, region: { from: [0, 0], to: [0.3, 0.3] } },
    ],
    1000,
    800
  );
  expect(texts).toEqual(['2', '5']);
});
