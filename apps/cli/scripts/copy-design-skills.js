#!/usr/bin/env node

import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.resolve(cliDirectory, '../../packages/design-authoring/skills');

/**
 * Stage the bundled design skill directories beside the CLI entries as
 * `design-skills/`. The daemon materializes them into design-session workdirs
 * (src/design/skills.ts). The design-authoring build (which embeds the frozen
 * capability matrix and bundles the skill script library) must have run first;
 * the `prepare:design-authoring` package script guarantees that in both the dev
 * and production build chains.
 */
export async function copyDesignSkills(outputDirectory) {
  const destinationDirectory = path.join(outputDirectory, 'design-skills');
  await rm(destinationDirectory, { recursive: true, force: true });
  await cp(sourceDirectory, destinationDirectory, { recursive: true });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outputDirectory = path.resolve(cliDirectory, process.argv[2] ?? 'dist');
  await copyDesignSkills(outputDirectory);
}
