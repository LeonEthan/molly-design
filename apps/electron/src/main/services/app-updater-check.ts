import type { ElectronUpdaterPhase } from '@molly/shared/electron-ipc'

export const UPDATE_CHECK_UNANSWERED_MS = 30_000

export function shouldResetPhaseForManualCheck(phase: ElectronUpdaterPhase): boolean {
  return phase !== 'downloading' && phase !== 'downloaded' && phase !== 'disabled'
}

export type TimeoutHandle = { cancel(): void }

/** electron-updater keeps a hung check on this field and returns the same promise. */
export function releaseUpdaterCheckLock(updater: {
  checkForUpdatesPromise?: Promise<unknown> | null
}): void {
  updater.checkForUpdatesPromise = null
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
