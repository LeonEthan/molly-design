#!/usr/bin/env node
// layout-json.mjs — derive MOSS-Image layout JSON from a layout-first artwork
// (see the design-research skill's references/layout-first.md). It reads the
// same validated document intake reads and never changes the project.
//
// Usage (from this skill's directory):
//   node scripts/layout-json.mjs <project>/design.yaml [--size WxH] [--out file]
//
// Mapping:
//   text `layout-summary`             -> summary.caption (required)
//   shape whose id starts `layout-`   -> object item, caption = the `layout-`
//                                        text label sharing its groupId
//   text whose id does not start `layout-` -> text item, caption = style summary
//   anything else                     -> skipped (listed on stderr)
// Boxes are `yxyx` pixels with the canvas centre as origin
// (`abs_centralized`), scaled to the output size. By default the output keeps
// the canvas ratio at about 1,048,576 pixels with both sides multiples of 16;
// `--size` must name multiples of 16. Rotated elements use their unrotated
// bounds, with a warning. Captions may be rewritten afterwards; `text` and
// `bbox` may not.
//
// This is an optional helper, not a gate: Molly validates the project at
// intake regardless.

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validate } from './lib/molly-authoring.mjs';

const USAGE = 'usage: node layout-json.mjs <project>/design.yaml [--size WxH] [--out file]';
const TARGET_PIXELS = 1_048_576;
const LAYOUT_PREFIX = 'layout-';
const SUMMARY_ID = 'layout-summary';

const fail = (message, code) => {
  console.error(`layout-json: ${message}`);
  process.exit(code);
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
let entry;
let sizeArg;
let outPath;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--size' || arg === '--out') {
    const value = args[index + 1];
    if (value === undefined) {
      console.error(USAGE);
      process.exit(2);
    }
    if (arg === '--size') sizeArg = value;
    else outPath = value;
    index += 1;
  } else if (entry === undefined && !arg.startsWith('--')) {
    entry = arg;
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
if (!entry || !existsSync(entry)) {
  console.error(`${USAGE} (file must exist)`);
  process.exit(2);
}

const resolved = path.resolve(entry);
const result = validate(resolved, { projectRoot: path.dirname(resolved) });
if (!result.ok) {
  for (const d of result.diagnostics) console.error(`${d.code} ${d.path}: ${d.message}`);
  fail(`${result.diagnostics.length} diagnostic(s); fix the artwork first`, 1);
}

const artwork = result.document;
const [canvasW, canvasH] = artwork.size;

const roundTo16 = (value) => Math.max(16, Math.round(value / 16) * 16);
let width;
let height;
if (sizeArg !== undefined) {
  const match = /^(\d+)x(\d+)$/.exec(sizeArg);
  if (!match) fail(`--size must be WxH, got "${sizeArg}"`, 1);
  width = Number(match[1]);
  height = Number(match[2]);
  if (width <= 0 || height <= 0 || width % 16 !== 0 || height % 16 !== 0)
    fail(`--size sides must be positive multiples of 16, got ${sizeArg}`, 1);
} else {
  const scale = Math.sqrt(TARGET_PIXELS / (canvasW * canvasH));
  width = roundTo16(canvasW * scale);
  height = roundTo16(canvasH * scale);
}
const scaleX = width / canvasW;
const scaleY = height / canvasH;

const textOf = (element) =>
  (element.text?.paragraphs ?? [])
    .map((paragraph) => (paragraph.runs ?? []).map((run) => run.text ?? '').join(''))
    .join('\n');

const bboxOf = ([x, y, w, h]) => [
  Math.round(y * scaleY - height / 2),
  Math.round(x * scaleX - width / 2),
  Math.round((y + h) * scaleY - height / 2),
  Math.round((x + w) * scaleX - width / 2),
];

const styleCaption = (element) => {
  const text = element.text ?? {};
  const runs = (text.paragraphs ?? []).flatMap((paragraph) => paragraph.runs ?? []);
  const parts = [text.fontFamily ?? runs.find((run) => run.fontFamily)?.fontFamily ?? 'Inter'];
  if (runs.some((run) => run.bold)) parts.push('bold');
  const color = text.color ?? runs.find((run) => run.color)?.color;
  if (color) parts.push(color);
  return parts.join(' ');
};

const elements = artwork.elements;
const summary = elements.find((element) => element.id === SUMMARY_ID && element.kind === 'text');
if (!summary) fail(`no text element "${SUMMARY_ID}"; add the scene and style summary`, 1);

const isLayout = (element) => element.id.startsWith(LAYOUT_PREFIX);
const labelFor = (shape) => {
  if (shape.groupId === undefined) return undefined;
  const label = elements.find(
    (element) =>
      element !== shape &&
      element.kind === 'text' &&
      isLayout(element) &&
      element.id !== SUMMARY_ID &&
      element.groupId === shape.groupId
  );
  return label ? textOf(label).trim() : undefined;
};

const items = [];
const skipped = [];
const warnings = [];
for (const element of elements) {
  if (element === summary) continue;
  if (element.kind === 'text' && isLayout(element)) continue;
  let item;
  if (element.kind === 'shape' && isLayout(element)) {
    const caption = labelFor(element);
    if (!caption) warnings.push(`${element.id} has no label in its group; caption left empty`);
    item = { label: 'object', caption: caption ?? '', bbox: bboxOf(element.bounds) };
  } else if (element.kind === 'text') {
    item = {
      label: 'text',
      caption: styleCaption(element),
      text: textOf(element),
      bbox: bboxOf(element.bounds),
    };
  } else {
    skipped.push(`${element.id} (${element.kind})`);
    continue;
  }
  if (element.rotation) warnings.push(`${element.id} is rotated; using its unrotated bounds`);
  items.push(item);
}

const output = {
  width,
  height,
  layout: {
    summary: { caption: textOf(summary).trim() },
    items,
    bbox_format: 'yxyx',
    bbox_coord_space: 'abs_centralized',
  },
};
const json = `${JSON.stringify(output, null, 2)}\n`;
if (outPath !== undefined) writeFileSync(outPath, json);
else process.stdout.write(json);

for (const warning of warnings) console.error(`layout-json: warning: ${warning}`);
console.error(
  `layout-json: ${width}x${height}, ${items.length} items` +
    (skipped.length ? `, skipped: ${skipped.join(', ')}` : '')
);
