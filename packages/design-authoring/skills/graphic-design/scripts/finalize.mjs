#!/usr/bin/env node
// finalize.mjs — validate a YAML artwork draft with the shared Molly intake
// validator (the same code the daemon runs at intake after your turn) and
// promote it to design.yaml when clean.
//
// Usage: node finalize.mjs <path/to/design.yaml[.tmp]>
//
// Exit 0 (renaming a .tmp draft to design.yaml) on success; exit 1 with one
// "CODE path: message" line per diagnostic on failure. This is a self-check
// convenience, not a gate: Molly re-validates at intake regardless, and you
// may promote the draft yourself as long as the final entry is design.yaml.
//
// The validator ships pre-bundled in ./lib/molly-authoring.mjs (built from
// @molly/design-authoring), so this script runs anywhere Node 22+ is
// available, with no repo checkout.

import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { validate } from './lib/molly-authoring.mjs';

const draft = process.argv[2];
const isTmpDraft = typeof draft === 'string' && draft.endsWith('.yaml.tmp');
const isFinal = typeof draft === 'string' && path.basename(draft) === 'design.yaml';
if (!draft || (!isTmpDraft && !isFinal) || !existsSync(draft)) {
  console.error('usage: node finalize.mjs <path/to/design.yaml[.tmp]> (file must exist)');
  process.exit(2);
}

const resolved = path.resolve(draft);
const result = validate(resolved, { projectRoot: path.dirname(resolved) });

if (!result.ok) {
  for (const d of result.diagnostics) {
    console.error(`${d.code} ${d.path}: ${d.message}`);
  }
  console.error(`finalize: ${result.diagnostics.length} diagnostic(s); draft left in place`);
  process.exit(1);
}

if (isTmpDraft) {
  const target = resolved.slice(0, -'.tmp'.length);
  renameSync(resolved, target);
  console.log(`finalize: OK → ${target}`);
} else {
  console.log(`finalize: OK → ${resolved}`);
}
