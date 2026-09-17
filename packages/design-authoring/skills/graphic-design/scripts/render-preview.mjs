#!/usr/bin/env node
// render-preview.mjs — self-check that a YAML artwork project passes Molly
// intake (validate + YAML→BentoDoc v4 import + asset binding) exactly as the
// daemon will run it after your turn, then report where visual preview comes
// from.
//
// Usage: node render-preview.mjs <project>/design.yaml
//
// Visual rendering is NOT done by this script. Preview rendering goes through
// the `molly_render_preview` MCP tool when the app's render provider is
// connected; call that tool, then open the PNG it returns. This script exists
// as an optional local structural check, not a prerequisite for rendering.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { collectAuthoring, intakeAuthoring } from './lib/molly-authoring.mjs';

const entry = process.argv[2];
if (!entry || path.basename(entry) !== 'design.yaml' || !existsSync(entry)) {
  console.error('usage: node render-preview.mjs <project>/design.yaml (file must exist)');
  process.exit(2);
}

const projectDir = path.dirname(path.resolve(entry));

let snapshot;
try {
  snapshot = collectAuthoring(projectDir);
} catch (error) {
  console.error(`render-preview: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const intake = intakeAuthoring('design.yaml', snapshot);
if (intake.status === 'invalid') {
  for (const d of intake.diagnostics) {
    console.error(`${d.code} ${d.path}: ${d.message}`);
  }
  console.error(`render-preview: ${intake.diagnostics.length} validation diagnostic(s)`);
  process.exit(1);
}
if (intake.status === 'unsupported') {
  console.error(`render-preview: artwork import unsupported: ${JSON.stringify(intake.issues)}`);
  process.exit(1);
}

console.log(
  `render-preview: intake OK (${intake.document.elements.length} element(s), ${intake.assets.size} asset(s), profile ${intake.profileVersion})`
);
console.log(
  'render-preview: visual rendering is provided by the molly_render_preview MCP tool. ' +
    'This script does not render or review images. If that tool is absent, only that tool ' +
    'is unavailable; use other actual Agent image capabilities as appropriate.'
);
