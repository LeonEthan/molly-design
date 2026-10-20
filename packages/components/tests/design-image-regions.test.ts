// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DESIGN_STROKE_POINTS_MAX } from '@molly/shared/design-selection-commands';
import {
  appendStrokePoint,
  drawNoteRegions,
  regionAnchor,
  regionCorners,
  regionFromPoints,
  regionOutline,
  strokeRegion,
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
    kind: 'box',
    from: [0.1, 0.2],
    to: [0.6, 0.8],
  });
});

it('lists a box as its four corners in order', () => {
  expect(regionCorners({ kind: 'box', from: [0.1, 0.2], to: [0.6, 0.8] })).toEqual([
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
      { badge: 2, region: { kind: 'box', from: [0.1, 0.2], to: [0.6, 0.8] } },
      { badge: 5, region: { kind: 'box', from: [0, 0], to: [0.3, 0.3] } },
      { badge: 7, region: { kind: 'stroke', points: [[0.1, 0.1], [0.4, 0.4]] } },
    ],
    1000,
    800
  );
  expect(texts).toEqual(['2', '5', '7']);
});

it('keeps a stroke point only once it moves past the step from the last kept point', () => {
  const points: [number, number][] = [];
  appendStrokePoint(points, [0.5, 0.5]);
  appendStrokePoint(points, [0.501, 0.5]);
  appendStrokePoint(points, [0.52, 0.5]);
  expect(points).toEqual([
    [0.5, 0.5],
    [0.52, 0.5],
  ]);
});

it('resamples a dense stroke evenly to the schema cap and keeps both ends', () => {
  const dense = Array.from({ length: 1000 }, (_, index): [number, number] => [index / 999, 0.5]);
  const region = strokeRegion(dense);
  expect(region?.kind).toBe('stroke');
  expect(region?.points).toHaveLength(DESIGN_STROKE_POINTS_MAX);
  expect(region?.points[0]).toEqual([0, 0.5]);
  expect(region?.points.at(-1)).toEqual([1, 0.5]);
});

it('drops a dot and keeps a short stroke as drawn', () => {
  expect(strokeRegion([[0.2, 0.2]])).toBeUndefined();
  expect(
    strokeRegion([
      [0.2, 0.2],
      [0.3, 0.4],
    ])
  ).toEqual({
    kind: 'stroke',
    points: [
      [0.2, 0.2],
      [0.3, 0.4],
    ],
  });
});

it('outlines a stroke by its own points and anchors its number on the first point', () => {
  const stroke = {
    kind: 'stroke' as const,
    points: [
      [0.2, 0.2],
      [0.3, 0.4],
    ] as [number, number][],
  };
  expect(regionOutline(stroke)).toEqual(stroke.points);
  expect(regionAnchor(stroke)).toEqual([0.2, 0.2]);
});
