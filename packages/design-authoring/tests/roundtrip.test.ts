import { convertTwoFileSnapshot } from '../src/migrate-two-file.ts';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  exportAuthoring,
  loadBentoDocV4,
  intakeAuthoring,
  validate,
  collectAuthoring,
  AUTHORING_PROJECTION_CAPABILITIES,
} from '../src/index.ts';
import {
  BENTO_DOC_V4_FIELDS,
  CHART_SERIES_TYPES,
  createVisualDocumentKernel,
  type BentoDocV4,
  type BentoElementV4,
  type BentoChartSeriesV4,
  type BentoTextContentV4,
} from '../src/contracts.ts';

const png = new Uint8Array(
  readFileSync(
    new URL('../skills/graphic-design/examples/minimal/media/swatch.png', import.meta.url)
  )
);
const digest = createHash('sha256').update(png).digest('hex');
const image = `asset:${digest}`;
// Existing synthetic fixture font is an offline, redistributable test resource.
const sample = JSON.parse(
  readFileSync(new URL('../../design-bento/sample.json', import.meta.url), 'utf8')
);
const fontBytes = new Uint8Array(
  Buffer.from(
    (Object.values(sample.assets) as string[])
      .find((s) => s.startsWith('data:font/'))!
      .split(',')[1]!,
    'base64'
  )
);
const fontDigest = createHash('sha256').update(fontBytes).digest('hex');
const assets = new Map([
  [digest, png],
  [fontDigest, fontBytes],
]);
const solid = { type: 'solid' as const, color: '#12345678' };
const gradient = {
  type: 'gradient' as const,
  gradientType: 'linear' as const,
  angle: 37,
  stops: [
    { position: 0, color: '#112233' },
    { position: 1, color: '#abcdef80' },
  ],
};
const radial = {
  type: 'gradient' as const,
  gradientType: 'radial' as const,
  stops: gradient.stops,
};
const imageFill = {
  type: 'image' as const,
  src: image,
  fit: 'contain' as const,
  crop: [-0.1, 0.1, 0.2, 0.1] as [number, number, number, number],
  opacity: 0.7,
};
const border = { style: 'dash' as const, width: 2, color: '#445566' };
const text: BentoTextContentV4 = {
  paragraphs: [
    {
      runs: [
        {
          text: 'A<&\nasset:literal media/text \\(x\\)',
          color: '#123456',
          fontSize: 23,
          fontFamily: { latin: 'Fixture Mono', ea: 'sans-serif' },
          backgroundColor: '#abcdef',
          bold: false,
          italic: true,
          underline: true,
          strikethrough: true,
          baselineShift: 'sup',
          href: 'https://example.com/?a=1&b=2',
          latex: 'x^2',
        },
        { text: '' },
        { text: 'B', baselineShift: 'sub' },
      ],
      align: 'justify',
      lineHeight: '25px',
      margin: { top: 1, left: 2, right: 3 },
      list: {
        ordered: true,
        marker: 'decimal',
        indent: 1,
        style: {
          align: 'right',
          lineHeight: 1.4,
          letterSpacing: 2,
          marginTop: 3,
          marginLeft: 4,
          marker: 'upper-roman',
        },
      },
    },
    { runs: [] },
    { runs: [{ text: '' }], list: { ordered: false, marker: 'square' } },
  ],
  color: '#445566',
  fontSize: 20,
  fontFamily: 'Fixture Mono, serif',
  bold: true,
  italic: false,
  backgroundColor: '#abcdef80',
  lineHeight: 1.2,
  letterSpacing: -1,
  marginTop: 2,
  textDirection: 'vertical',
  wrap: false,
  align: ['distributed', 'bottom'],
  gradient,
};
const base = (id: string) => ({
  id,
  bounds: [5, 6, 200, 120] as [number, number, number, number],
  zIndex: 0,
  groupId: 'group / same',
  opacity: 0.6,
  shadow: [
    { blur: 1, color: '#223344', offset: [2, -3] as [number, number] },
    { blur: 4, color: '#11223380' },
  ],
});
const cellStyle = {
  color: '#123456',
  fontSize: 16,
  fontFamily: 'Fixture Mono',
  bold: false,
  italic: true,
  backgroundColor: '#8899aa',
  lineHeightPx: 20,
  letterSpacing: 1,
  marginTop: -1,
  fill: imageFill,
  border: [null, border] as [null, typeof border],
  align: ['center', 'middle'] as ['center', 'middle'],
};
const axis = {
  show: true,
  type: 'value' as const,
  min: 0,
  max: 100,
  reverse: true,
  title: { text: 'Axis', color: '#123456', fontSize: 13, fontFamily: 'serif' },
  label: { numberFormat: '0.0', color: '#123456', fontSize: 12, fontFamily: 'serif' },
  axisLine: { ...border, arrow: 'both' as const },
  gridLine: border,
};
const labels = {
  show: true,
  content: 'value' as const,
  numberFormat: '0.0',
  color: '#445566',
  fontSize: 12,
  fontFamily: 'serif',
};
const linear = {
  smooth: true,
  lineStyle: 'dot' as const,
  width: 3,
  marker: { shape: 'diamond' as const, fill: '#123456', border, size: 6 },
  nullHandling: 'gap' as const,
  lineColor: gradient,
};
const xy = { x: 'x', y: 'y' };
const data = {
  cols: [
    'x',
    'y',
    'size',
    'high',
    'low',
    'close',
    'open',
    'category',
    'value',
    'isTotal',
    'parent',
    'source',
    'target',
    'flow',
  ],
  rows: [
    [1, 5, 2, 8, 2, 5, 4, 'A', 5, 'false', '', 'A', 'B', 2],
    [2, 8, 4, 9, 3, 6, 5, 'B', 8, 'true', '', 'B', 'C', 3],
  ],
};
const series: BentoChartSeriesV4[] = [
  {
    type: 'bar',
    encode: xy,
    stack: 'percent',
    symbol: { shapeName: 'rect' },
    fill: gradient,
    border,
    dataLabels: labels,
  },
  { type: 'line', encode: xy, ...linear, dataLabels: labels },
  { type: 'area', encode: xy, ...linear, stack: 'stream', areaColor: radial, dataLabels: labels },
  {
    type: 'scatter',
    encode: xy,
    dataFilter: { col: 'category', value: 'A' },
    marker: linear.marker,
    fill: gradient,
    border,
    dataLabels: labels,
  },
  {
    type: 'bubble',
    encode: { ...xy, size: 'size' },
    dataFilter: { col: 'category', value: 'A' },
    sizeScale: 'sqrt',
    sizeRange: [3, 12],
    fill: radial,
    border,
    dataLabels: labels,
  },
  {
    type: 'candlestick',
    encode: { x: 'x', high: 'high', low: 'low', close: 'close', open: 'open' },
    upBars: { fill: '#112233', border },
    downBars: { fill: '#445566', border },
    wickStyle: border,
  },
  {
    type: 'pie',
    encode: { category: 'category', value: 'value' },
    innerRadius: 0.3,
    startAngle: 20,
    fill: ['#123456', '#abcdef'],
    border,
    dataLabels: labels,
  },
  {
    type: 'radar',
    encode: { category: 'category', y: 'y' },
    ...linear,
    areaColor: '#123456',
    dataLabels: labels,
  },
  {
    type: 'waterfall',
    encode: { ...xy, isTotal: 'isTotal' },
    totalBars: { fill: '#123456', border },
    increaseBars: { fill: '#334455', border },
    decreaseBars: { fill: '#556677', border },
    dataLabels: labels,
  },
  {
    type: 'heatmap',
    encode: { x: 'x', y: 'y', value: 'value' },
    colorScheme: ['#123456', '#abcdef'],
    colorScale: { type: 'linear', domain: [0, 10] },
    colorbar: { show: true, position: 'right' },
    dataLabels: labels,
  },
  {
    type: 'treemap',
    encode: { category: 'category', value: 'value', parent: 'parent' },
    levels: 2,
    fill: [['#123456'], ['#abcdef']],
    border,
    dataLabels: labels,
  },
  {
    type: 'sunburst',
    encode: { category: 'category', value: 'value', parent: 'parent' },
    levels: 2,
    fill: ['#123456', '#abcdef'],
    border,
    dataLabels: labels,
  },
  {
    type: 'sankey',
    encode: { source: 'source', target: 'target', flow: 'flow' },
    nodeAlign: 'justify',
    fill: { A: '#123456', B: '#abcdef' },
    border,
    dataLabels: labels,
  },
];
function chart(s: BentoChartSeriesV4): BentoElementV4 {
  return {
    ...base(s.type),
    kind: 'chart',
    border,
    chart: {
      data,
      series: [{ ...s, name: s.type, xAxisIndex: 0, yAxisIndex: 0 }],
      title: { text: 'Title', fontFamily: 'serif', color: '#123456', fontSize: 20 },
      legend: {
        show: false,
        position: 'bottom',
        color: '#123456',
        fontSize: 15,
        fontFamily: 'serif',
      },
      dataLabels: labels,
      fontFamily: 'serif',
      palette: ['#abcdef', '#123456'],
      fill: imageFill,
    },
  };
}
const elements: BentoElementV4[] = [
  { ...base('__proto__'), kind: 'text', text, rotation: -12, flip: [true, false] },
  {
    ...base('shape'),
    kind: 'shape',
    shapeName: 'custom',
    viewBox: [100, 100],
    path: 'M0 0 L100 0 L100 100 Z',
    fill: gradient,
    border,
    rotation: 22,
    flip: [false, true],
  },
  {
    ...base('line'),
    kind: 'line',
    viewBox: [100, 100],
    points: '0,0  5e1,25 100,100',
    curve: 'smooth',
    arrow: [null, 'stealth'],
    border,
  },
  {
    ...base('image'),
    kind: 'image',
    src: image,
    fit: 'fill',
    crop: [-0.1, 0.2, 0.1, 0.2],
    cropShape: { shapeName: 'ellipse' },
    border,
  },
  { ...base('icon'), kind: 'icon', iconName: 'fas:star', fill: imageFill, border },
  {
    ...base('table'),
    kind: 'table',
    fill: imageFill,
    border,
    table: {
      columnWidths: [0.4, 0.6],
      rowHeights: [0.3, 0.7],
      rows: [
        [{ ...cellStyle, text, colSpan: 2 }],
        [
          { text: { paragraphs: [{ runs: [{ text: 'cell' }] }] }, border: null },
          { fill: solid, border: [null, border, null, border] },
        ],
      ],
      style: {
        cellStyle,
        firstRowStyle: cellStyle,
        lastRowStyle: cellStyle,
        firstColumnStyle: cellStyle,
        lastColumnStyle: cellStyle,
        bodyStyles: [cellStyle, { fill: radial }],
        rowOverColumn: false,
      },
    },
  },
];
function doc(es = elements): BentoDocV4 {
  return {
    schemaVersion: 4,
    canvas: { width: 800, height: 600 },
    background: imageFill,
    fonts: [{ family: 'Fixture Mono', src: `asset:${fontDigest}`, weight: '400', style: 'normal' }],
    elements: structuredClone(es).map((e, i) => ({ ...e, zIndex: i })),
    diagnostics: [],
  };
}
function roundtrip(document: BentoDocV4) {
  const before = structuredClone(document);
  const snapshot = exportAuthoring(document, assets);
  const result = intakeAuthoring('design.yaml', snapshot);
  expect(result.status, JSON.stringify(result)).toBe('ok');
  if (result.status !== 'ok') throw Error(JSON.stringify(result));
  expect(result.document).toEqual(before);
  expect(document).toEqual(before);
  expect([...exportAuthoring(result.document, result.assets)]).toEqual([...snapshot]);
  for (const [hash, bytes] of result.assets) expect(bytes).toEqual(assets.get(hash));
  for (const e of document.elements) expect(result.sourceMap[e.id]).toEqual([e.id]);
  return snapshot;
}

describe('existing editable semantics roundtrip', () => {
  it('preserves all seven element kinds, all base fields and exact rich text/table/assets', () => {
    roundtrip(doc([...elements, chart(series[0]!)]));
  });
  it.each(series)('preserves every $type series field', (s) => {
    roundtrip(doc([chart(s)]));
  });
  it('covers every base and kind field in the contract', () => {
    const fixtureElements = [
      ...elements,
      { ...chart(series[0]!), fill: solid },
      { ...elements[1]!, adjustments: [10000] },
    ];
    for (const [kind, fields] of Object.entries(BENTO_DOC_V4_FIELDS.elements)) {
      const available = new Set(
        fixtureElements.filter((e) => kind === 'common' || e.kind === kind).flatMap(Object.keys)
      );
      expect(
        fields.filter((field) => !available.has(field)),
        kind
      ).toEqual([]);
    }
    expect(series.map((s) => s.type)).toEqual([...CHART_SERIES_TYPES]);
  });
  it.each([solid, gradient, radial, imageFill])(
    'preserves $type background and image-fill defaults',
    (fill) => {
      const d = doc();
      d.background = fill;
      roundtrip(d);
    }
  );
  it.each(['fill', 'contain', 'cover', undefined] as const)(
    'preserves image fit %s including absence',
    (fit) => {
      const e = structuredClone(elements[3]!);
      if (e.kind !== 'image') throw Error('fixture');
      if (fit === undefined) delete e.fit;
      else e.fit = fit;
      roundtrip(doc([e]));
    }
  );
  it('preserves explicit zIndex without renumbering or reordering', () => {
    const d = doc();
    d.elements.reverse();
    d.elements[0]!.zIndex = 99;
    roundtrip(d);
  });
  it('preserves absent fonts, empty fonts, empty elements, empty shadow and diagnostics', () => {
    const d = doc([]);
    d.background = solid;
    delete d.fonts;
    roundtrip(d);
    d.fonts = [];
    roundtrip(d);
    d.elements = [{ ...base('empty-shadow'), kind: 'shape', shapeName: 'rect', shadow: [] }];
    d.diagnostics = [
      {
        code: 'PPTD-D101',
        path: 'legacy',
        message: 'preserved',
      } as BentoDocV4['diagnostics'][number],
    ];
    roundtrip(d);
  });
  it('preserves paragraph/list variants and fixed element line height', () => {
    const d = doc([elements[0]!]);
    const e = d.elements[0];
    if (e?.kind !== 'text') throw Error('fixture');
    delete e.text.lineHeight;
    e.text.lineHeightPx = 21;
    e.text.paragraphs[0]!.lineHeight = 1.6;
    e.text.paragraphs[0]!.list!.style!.lineHeight = '18px';
    roundtrip(d);
  });
  it('preserves preset geometry adjustments and custom crop geometry', () => {
    const d = doc([elements[1]!, elements[3]!]);
    const shape = d.elements[0];
    const imageElement = d.elements[1];
    if (shape?.kind !== 'shape' || imageElement?.kind !== 'image') throw Error('fixture');
    shape.shapeName = 'roundRect';
    shape.adjustments = [20000];
    delete shape.path;
    delete shape.viewBox;
    imageElement.cropShape = {
      shapeName: 'custom',
      viewBox: [100, 100],
      path: 'M0 0 L100 0 L100 100 Z',
    };
    roundtrip(d);
  });
  it('preserves mixed chart options, secondary axes and labels', () => {
    const c = chart(series[0]!);
    if (c.kind !== 'chart') throw Error('fixture');
    c.chart.series.push({ ...series[1]!, yAxisIndex: 1 });
    Object.assign(c.chart, {
      xAxis: {
        show: true,
        type: 'category',
        reverse: false,
        label: axis.label,
        axisLine: axis.axisLine,
        gridLine: axis.gridLine,
      },
      yAxis: [axis, { ...axis, reverse: false }],
      barWidth: 0.4,
      barGap: 0.2,
      categoryGap: 0.3,
    });
    roundtrip(doc([c]));
  });
  it('preserves radar spoke options', () => {
    const c = chart(series[7]!);
    if (c.kind !== 'chart') throw Error('fixture');
    c.chart.spokeAxis = {
      show: true,
      min: 0,
      max: 10,
      label: axis.label,
      axisLine: border,
      gridLine: false,
    };
    roundtrip(doc([c]));
  });
  it('preserves documents after edit, undo and redo', () => {
    const d = doc();
    const kernel = createVisualDocumentKernel(d);
    const applied = kernel.apply({
      batchId: 'edit',
      actor: 'human',
      baseRevision: 0,
      commands: [
        { type: 'setZOrder', targetId: 'shape', index: 0 },
        { type: 'setGroupId', targetId: 'shape', groupId: 'new group' },
        { type: 'setShadow', targetId: 'shape', shadow: [] },
      ],
    });
    expect(applied.ok).toBe(true);
    roundtrip(JSON.parse(kernel.snapshot()) as BentoDocV4);
    expect(kernel.undo().ok).toBe(true);
    roundtrip(JSON.parse(kernel.snapshot()) as BentoDocV4);
    expect(kernel.redo().ok).toBe(true);
    roundtrip(JSON.parse(kernel.snapshot()) as BentoDocV4);
  });
});

const encode = (v: unknown) => new TextEncoder().encode(stringify(v));
function mutateSnapshot(
  mutator: (manifest: Record<string, unknown>, page: Record<string, unknown>) => void
) {
  const snapshot = exportAuthoring(doc([...elements, chart(series[0]!)]), assets);
  const manifest = parse(new TextDecoder().decode(snapshot.get('design.yaml')));
  const page = manifest;
  mutator(manifest, page);
  snapshot.set('design.yaml', encode(manifest));
  return snapshot;
}
describe('version, compatibility and fail-closed inputs', () => {
  it.each(['v1', 'v2', 'v3', 'v4', 'unknown', null])(
    'rejects leftover PPTD version %s',
    (version) => {
      const snapshot = mutateSnapshot((manifest) => {
        manifest.version = version;
      });
      expect(intakeAuthoring('design.yaml', snapshot).status).toBe('invalid');
    }
  );
  it('rejects leftover PPTD v2 theme, HTML content and seriesDefaults', () => {
    const snapshot = new Map([
      [
        'design.pptd',
        encode({
          version: 'v2',
          size: [800, 600],
          pages: ['pages/old.page'],
          theme: {
            colors: { a: '#112233', b: '#aabbcc' },
            textStyles: { body: { color: '$a', fontSize: 24 } },
          },
        }),
      ],
      [
        'pages/old.page',
        encode({
          elements: [
            {
              elementId: 'old-text',
              elementType: 'text',
              bounds: [10, 10, 200, 120],
              content: { style: '$body', text: '<p><strong>Hello</strong><br/>world</p>' },
            },
            {
              elementId: 'old-chart',
              elementType: 'chart',
              bounds: [10, 140, 400, 250],
              data: {
                cols: ['x', 'y'],
                rows: [
                  ['A', 5],
                  ['B', 8],
                ],
              },
              seriesDefaults: { bar: { fill: '$b' } },
              series: [{ type: 'bar', encode: xy }],
            },
          ],
        }),
      ],
    ]);
    const imported = intakeAuthoring('design.pptd', snapshot);
    expect(imported.status).toBe('invalid');
    if (imported.status !== 'invalid') return;
    expect(imported.diagnostics.some((d) => d.message.includes('MOLLY-E-PPTD'))).toBe(true);
  });
  it('keeps filesystem and snapshot intake consistent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'molly-roundtrip-'));
    try {
      const snapshot = roundtrip(doc());
      for (const [rel, bytes] of snapshot) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), bytes);
      }
      const result = validate(path.join(root, 'design.yaml'), { projectRoot: root });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(intakeAuthoring('design.yaml', collectAuthoring(root))).toEqual(
        intakeAuthoring('design.yaml', snapshot)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const invalidPaths = [
    ['background', 'unknown'],
    ['elements', 0, 'unknown'],
    ['elements', 0, 'kind'],
    ['elements', 0, 'text', 'unknown'],
    ['elements', 0, 'text', 'paragraphs', 0, 'unknown'],
    ['elements', 0, 'text', 'paragraphs', 0, 'runs', 0, 'unknown'],
    ['elements', 0, 'text', 'paragraphs', 0, 'list', 'unknown'],
    ['elements', 0, 'text', 'paragraphs', 0, 'list', 'style', 'unknown'],
    ['elements', 0, 'shadow', 0, 'unknown'],
    ['elements', 1, 'fill', 'stops', 0, 'unknown'],
    ['elements', 3, 'cropShape', 'unknown'],
    ['elements', 5, 'table', 'unknown'],
    ['elements', 5, 'table', 'rows', 0, 0, 'unknown'],
    ['elements', 5, 'table', 'style', 'firstRowStyle', 'unknown'],
    ['elements', 6, 'chart', 'unknown'],
    ['elements', 6, 'chart', 'data', 'unknown'],
    ['elements', 6, 'chart', 'series', 0, 'unknown'],
    ['elements', 6, 'chart', 'series', 0, 'encode', 'unknown'],
    ['elements', 6, 'chart', 'title', 'unknown'],
    ['elements', 6, 'chart', 'legend', 'unknown'],
  ];
  it.each(invalidPaths.map((p) => [p.join('.'), p] as const))(
    'rejects unknown nested field %s',
    (_name, segments) => {
      const snapshot = mutateSnapshot((_manifest, page) => {
        let target: any = page;
        for (const segment of segments.slice(0, -1)) target = target[segment];
        target[segments.at(-1)!] = 'unmodeled';
      });
      expect(intakeAuthoring('design.yaml', snapshot).status).toBe('invalid');
    }
  );
  it.each([
    '../escape',
    'media/../escape',
    'media/a/b',
    'https://example.com/a.png',
    'asset:' + digest,
  ])('rejects nonlocal asset %s', (src) => {
    const snapshot = mutateSnapshot((_m, p) => {
      (p.elements as any[])[3].src = src;
    });
    expect(intakeAuthoring('design.yaml', snapshot).status).toBe('invalid');
  });
  it('rejects missing, corrupt and wrong-kind assets in both directions', () => {
    const snapshot = exportAuthoring(doc(), assets);
    snapshot.delete(`media/${digest}`);
    expect(intakeAuthoring('design.yaml', snapshot).status).toBe('invalid');
    snapshot.set(`media/${digest}`, new Uint8Array([1, 2, 3]));
    expect(intakeAuthoring('design.yaml', snapshot).status).toBe('invalid');
    expect(() => exportAuthoring(doc(), new Map())).toThrow(/Missing/);
    expect(() =>
      exportAuthoring(
        doc(),
        new Map([
          [digest, new Uint8Array([1, 2, 3])],
          [fontDigest, fontBytes],
        ])
      )
    ).toThrow(/corrupt/);
    const wrong = mutateSnapshot((m) => {
      (m.customFonts as any[])[0].src = `media/${digest}`;
    });
    expect(intakeAuthoring('design.yaml', wrong).status).toBe('invalid');
  });
  it('rejects duplicate IDs and invalid chart/crop/merge state', () => {
    for (const mutate of [
      (p: any) => {
        p.elements[1].id = p.elements[0].id;
      },
      (p: any) => {
        p.elements[3].crop = [1, 0, 1, 0];
      },
      (p: any) => {
        p.elements[5].table.rows[0][0].colSpan = 3;
      },
      (p: any) => {
        p.elements[6].chart.series[0].encode.y = 'missing';
      },
    ])
      expect(
        intakeAuthoring(
          'design.yaml',
          mutateSnapshot((_m, p) => mutate(p))
        ).status
      ).toBe('invalid');
  });
});

it('keeps the audited capability inventory complete alongside the field fixtures', () => {
  const audited = `canvas.size canvas.background
common.elementId common.elementType common.bounds common.zOrder common.rotation common.opacity common.flip common.group common.createDelete common.color common.theme common.styleInheritance common.border common.shadow
text.plain text.paragraphs text.lineBreak text.runs.color text.runs.fontSize text.runs.fontFamily text.runs.backgroundColor text.bold text.italic text.underline text.strikethrough text.superscript text.subscript text.hyperlink text.lists text.listItemStyles text.latex text.color text.fontSize text.backgroundColor text.lineHeight text.lineHeightPx text.letterSpacing text.marginTop text.align text.paragraphAlign text.paragraphLineHeight text.paragraphMargin text.textDirection text.wrap text.gradient text.shadow
font.familyUniform font.familyLatinEa font.registration font.fallback font.measurement
shape.preset shape.adjustments shape.customPath line.points line.curve line.arrow
image.src image.fit image.crop image.cropShape image.pipeline icon.name
table.grid table.cellText table.cellTextStyleRef table.cellTextProps table.cellFill table.cellBorder table.cellAlign table.merge table.styleRef table.styleSlots table.bodyStylesCycle table.rowOverColumn
chart.data chart.encode chart.seriesDefaults chart.typeMixing chart.axisBasic chart.axisLabel chart.axisLineGrid chart.axisSecondary chart.spokeAxis chart.barLayout chart.title chart.legend chart.dataLabels chart.bar chart.line chart.area chart.scatter chart.bubble chart.candlestick chart.pie chart.radar chart.waterfall chart.heatmap chart.treemap chart.sunburst chart.sankey chart.palette
fill.solid fill.gradientLinear fill.gradientRadial fill.image`
    .split(/\s+/)
    .sort();
  expect(AUTHORING_PROJECTION_CAPABILITIES.map((row) => row.capabilityId).sort()).toEqual(audited);
});

it('preserves and validates the legacy chart top-level fill field', () => {
  const c = { ...chart(series[0]!), fill: imageFill };
  roundtrip(doc([c]));
  expect(() =>
    exportAuthoring(
      doc([{ ...c, fill: { type: 'script', source: 'unmodeled' } } as unknown as BentoElementV4]),
      assets
    )
  ).toThrow();
});

it('projects shared style objects without YAML alias expansion limits', () => {
  const cell = { text: { paragraphs: [{ runs: [{ text: 'cell' }] }] }, fill: imageFill };
  const table: BentoElementV4 = {
    ...base('many-cells'),
    kind: 'table',
    table: {
      columnWidths: Array.from({ length: 128 }, () => 1 / 128),
      rowHeights: [1],
      rows: [Array.from({ length: 128 }, () => cell)],
    },
  };
  roundtrip(doc([table]));
});

it('rejects non-JSON canonical values instead of silently losing them', () => {
  const d = doc();
  d.elements[0]!.groupId = undefined;
  expect(() => exportAuthoring(d, assets)).toThrow(/JSON/);
});

it.each([1, 2, 3])(
  'projects legacy Bento schema %s after the existing migration',
  (schemaVersion) => {
    const legacy = {
      schemaVersion,
      canvas: { width: 800, height: 600, ...(schemaVersion < 3 ? { preset: 'legacy' } : {}) },
      background: solid,
      elements: [
        {
          id: 'legacy-text',
          kind: 'text',
          bounds: [10, 10, 100, 80],
          zIndex: 0,
          text: 'A\nB',
          fontSize: 20,
          color: '#123456',
        },
      ],
      diagnostics: [{ code: 'PPTD-D101', path: 'legacy', message: 'historical diagnostic' }],
    };
    const before = structuredClone(legacy);
    const migrated = loadBentoDocV4(legacy);
    roundtrip(migrated);
    expect(legacy).toEqual(before);
  }
);

it('folds long unbroken text scalars for native bounded reads without changing text', () => {
  const document = doc();
  const longText = 'A'.repeat(60_000);
  document.elements = [
    { ...base('long'), kind: 'text', text: { paragraphs: [{ runs: [{ text: longText }] }] } },
  ];
  const files = exportAuthoring(document, assets);
  const page = new TextDecoder().decode(files.get('design.yaml'));
  expect(Math.max(...page.split('\n').map((line) => Buffer.byteLength(line)))).toBeLessThan(1024);
  roundtrip(document);
});

it('migrates every native editable field and chart type without changing canonical data or assets', () => {
  for (const entry of series) {
    const expected = doc([...elements, { ...chart(entry), id: `migration-${entry.type}` }]);
    const source = exportAuthoring(expected, assets);
    const root = parse(new TextDecoder().decode(source.get('design.yaml')));
    const { format: _format, size, customFonts, background, elements: native, diagnostics } = root;
    source.set(
      'design.yaml',
      encode({
        size,
        pages: ['pages/canvas.yaml'],
        ...(customFonts !== undefined ? { customFonts } : {}),
      })
    );
    source.set('pages/canvas.yaml', encode({ background, elements: native, diagnostics }));
    const before = structuredClone(source);
    const migrated = convertTwoFileSnapshot(source);
    expect(source).toEqual(before);
    const result = intakeAuthoring('design.yaml', migrated);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') continue;
    expect(result.document).toEqual(expected);
    expect(
      [...result.assets].map(([id, bytes]) => [
        id,
        createHash('sha256').update(bytes).digest('hex'),
      ])
    ).toEqual([...result.assets.keys()].map((id) => [id, id]));
  }
});
