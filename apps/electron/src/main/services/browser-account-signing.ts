import { spawnSync } from 'node:child_process'

/** Keychain ACLs need a stable signing identity across app updates. */
export function hasStableMacSigningIdentity(output: string): boolean {
  return (
    !/^Signature=adhoc$/m.test(output) &&
    /^TeamIdentifier=[A-Z0-9]{10}$/m.test(output) &&
    /^Authority=/m.test(output)
  )
}

let cachedExecutable: string | undefined
let cachedResult = false

export function isStableSignedMacApp(executable: string): boolean {
  if (cachedExecutable === executable) return cachedResult
  cachedExecutable = executable
  const inspection = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', executable], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64 * 1024
  })
  cachedResult = inspection.status === 0 && hasStableMacSigningIdentity(inspection.stderr ?? '')
  return cachedResult
}
