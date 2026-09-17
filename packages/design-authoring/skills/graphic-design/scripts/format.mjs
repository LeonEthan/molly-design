#!/usr/bin/env node
// format.mjs — query the molly-canvas/1 admission table derived from the same
// validator that runs at intake after your turn. Use it to check which kinds
// and fields are admitted, and which constructs are explicitly rejected,
// before writing them into design.yaml.
//
// Usage (from this skill's directory):
//   node scripts/format.mjs                  # overview: root fields, kinds, exclusion summary
//   node scripts/format.mjs kind <kind>      # admitted fields for one element kind
//   node scripts/format.mjs excluded         # all explicit exclusions with reasons
//
// This is an optional lookup helper, not a gate: Molly validates the collected
// project at intake regardless, and value-level constraints (geometry, media
// bytes, fonts) are still enforced by the validator itself.

import { describeAuthoringFormat } from './lib/molly-authoring.mjs';

const [subcommand, arg] = process.argv.slice(2);
const description = describeAuthoringFormat();

const renderKind = (kind) => {
  const found = description.kinds.find((entry) => entry.kind === kind);
  if (!found) {
    console.error(
      `format: unknown kind "${kind}"; admitted kinds: ${description.kinds
        .map((entry) => entry.kind)
        .join(', ')}`
    );
    process.exit(1);
  }
  console.log(`kind: ${found.kind}`);
  console.log('admitted fields:');
  for (const field of found.fields) console.log(`  ${field}`);
  const exclusions = description.exclusions.filter((exclusion) => exclusion.scope === found.kind);
  if (exclusions.length) {
    console.log('exclusions at this layer:');
    for (const exclusion of exclusions) console.log(`  ${exclusion.name} — ${exclusion.reason}`);
  }
};

switch (subcommand) {
  case undefined:
    console.log(`format: ${description.format} (entry: ${description.entry})`);
    console.log('root fields:');
    for (const field of description.rootFields) console.log(`  ${field}`);
    console.log('element kinds:');
    for (const entry of description.kinds) console.log(`  ${entry.kind}`);
    console.log(
      `exclusions: ${description.exclusions.length} (run \`format.mjs excluded\` for reasons)`
    );
    for (const note of description.notes) console.log(`note: ${note}`);
    break;
  case 'kind':
    if (!arg) {
      console.error('usage: node format.mjs kind <kind>');
      process.exit(2);
    }
    renderKind(arg);
    break;
  case 'excluded':
    for (const exclusion of description.exclusions)
      console.log(`[${exclusion.scope}] ${exclusion.name} — ${exclusion.reason}`);
    break;
  default:
    console.error('usage: node format.mjs [kind <kind> | excluded]');
    process.exit(2);
}
