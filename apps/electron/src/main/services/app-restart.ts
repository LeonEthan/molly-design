import { formatUnknownError } from '../utils'
import { setAppQuitting } from '../window-state'

export type RestartMollyResult = { ok: true } | { ok: false; error: string }

export async function restartMolly(options: {
  prepareRestart?: () => Promise<() => Promise<void>>
  relaunch: () => void
  quit: () => void
}): Promise<RestartMollyResult> {
  let release: (() => Promise<void>) | undefined
  try {
    release = await options.prepareRestart?.()
  } catch (error) {
    return { ok: false, error: formatUnknownError(error) }
  }
  setAppQuitting(true)
  try {
    options.relaunch()
    options.quit()
    return { ok: true }
  } catch (error) {
    setAppQuitting(false)
    await release?.()
    return { ok: false, error: formatUnknownError(error) }
  }
}
