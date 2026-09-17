#!/usr/bin/env node
// Explicit local conversion only. Never saves current artwork or submits a turn.
import { migrateTwoFileArtwork } from './lib/molly-authoring.mjs';
const [source, output, ...extra] = process.argv.slice(2);
if (!source || !output || extra.length) {
  console.error('usage: node migrate-two-file.mjs <old-draft-directory> <new-output-directory>');
  process.exit(2);
}
try {
  console.log(JSON.stringify(migrateTwoFileArtwork(source, output), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
