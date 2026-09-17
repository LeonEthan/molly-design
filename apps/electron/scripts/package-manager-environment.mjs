import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Keep Builder's bare pnpm invocations on the caller's pinned package manager. */
export function packageManagerEnvironment({
  directory,
  command,
  entrypoint,
  env = process.env,
  platform = process.platform
}) {
  const quoteShell = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
  const shimPath = path.join(directory, platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  writeFileSync(
    shimPath,
    platform === 'win32'
      ? `@echo off\r\n"${command}" "${entrypoint}" %*\r\n`
      : `#!/bin/sh\nexec ${quoteShell(command)} ${quoteShell(entrypoint)} "$@"\n`
  )
  if (platform !== 'win32') chmodSync(shimPath, 0o755)
  return { ...env, PATH: directory + path.delimiter + (env.PATH ?? '') }
}
