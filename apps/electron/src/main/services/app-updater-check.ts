import type { ElectronUpdaterPhase } from '@molly/shared/electron-ipc'

export const UPDATE_CHECK_UNANSWERED_MS = 30_000

export function shouldResetPhaseForManualCheck(phase: ElectronUpdaterPhase): boolean {
  return phase !== 'downloading' && phase !== 'downloaded' && phase !== 'disabled'
}

export type TimeoutHandle = { cancel(): void }

export function cancelSparkleCheck(sparkle: object): void {
  if (!('cancelCheck' in sparkle)) return
  const cancel = Reflect.get(sparkle, 'cancelCheck')
  if (typeof cancel !== 'function') return
  cancel.call(sparkle)
}

export function recoverUnansweredCheck(input: {
  sparkle: object | null
  sparkleSessionOpen: boolean
}): { sparkleSessionOpen: false; ignoreUntilChecking: boolean } {
  const cancelOpenSparkleSession = input.sparkle !== null && input.sparkleSessionOpen
  if (cancelOpenSparkleSession && input.sparkle) cancelSparkleCheck(input.sparkle)
  return {
    sparkleSessionOpen: false,
    ignoreUntilChecking: cancelOpenSparkleSession
  }
}

export function beginSparkleCheck(input: {
  bridge: object & { checkForUpdates(): void }
  sessionOpen: boolean
}): { started: boolean; sessionOpen: boolean; ignoreUntilChecking: boolean } {
  if (input.sessionOpen) {
    cancelSparkleCheck(input.bridge)
    return { started: false, sessionOpen: false, ignoreUntilChecking: true }
  }
  input.bridge.checkForUpdates()
  return { started: true, sessionOpen: true, ignoreUntilChecking: false }
}

export function nextSparkleEventGate(
  ignoreUntilChecking: boolean,
  eventType: string | undefined
): { deliver: boolean; ignoreUntilChecking: boolean } {
  if (!ignoreUntilChecking || eventType === 'checking') {
    return { deliver: true, ignoreUntilChecking: false }
  }
  return { deliver: false, ignoreUntilChecking: true }
}

/**
 * A check that never leaves `checking` must become an error the user can retry.
 * `schedule` must not run the callback before returning the handle.
 */
export function createCheckingWatchdog(deps: {
  delayMs: number
  schedule: (callback: () => void, delayMs: number) => TimeoutHandle
  isChecking: () => boolean
  onUnanswered: () => void
}) {
  let active: TimeoutHandle | null = null
  const clear = (): void => {
    active?.cancel()
    active = null
  }
  return {
    sync(phase: ElectronUpdaterPhase): void {
      clear()
      if (phase !== 'checking') return
      active = deps.schedule(() => {
        active = null
        if (deps.isChecking()) deps.onUnanswered()
      }, deps.delayMs)
    },
    stop(): void {
      clear()
    }
  }
}
