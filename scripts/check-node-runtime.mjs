#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_NODE_API_VERSION = 10;

export function isNodeVersionSupported(nodeVersion) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion ?? '');
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major === 22 && minor >= 19) || (major === 23 && minor >= 6) || major >= 24;
}

export function isNodeApiVersionSupported(nodeApiVersion) {
  if (typeof nodeApiVersion !== 'string' || nodeApiVersion.trim().length === 0) {
    return false;
  }

  const parsed = Number(nodeApiVersion);
  return Number.isInteger(parsed) && parsed >= REQUIRED_NODE_API_VERSION;
}

export function describeUnsupportedNodeRuntime({ nodeVersion, nodeApiVersion }) {
  if (isNodeVersionSupported(nodeVersion) && isNodeApiVersionSupported(nodeApiVersion)) {
    return undefined;
  }

  return (
    `Molly requires Node.js v22.19.0 for Pi and Node-API ${REQUIRED_NODE_API_VERSION} for SQLite. ` +
    `Use Node.js v22.19.0 through v22.x, v23.6.0+, or a later major release ` +
    `(current: ${nodeVersion}, Node-API ${nodeApiVersion ?? 'unknown'}).`
  );
}

export function assertNodeRuntimeSupported({
  nodeVersion = process.version,
  nodeApiVersion = process.versions.napi,
} = {}) {
  const problem = describeUnsupportedNodeRuntime({ nodeVersion, nodeApiVersion });
  if (problem === undefined) {
    return;
  }

  console.error(problem);
  process.exitCode = 1;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href) {
  assertNodeRuntimeSupported();
}
