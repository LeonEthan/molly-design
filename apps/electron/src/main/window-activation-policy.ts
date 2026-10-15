export type WindowActivationState = {
  windowCount: number
  mainWindowVisible: boolean
  mainWindowMinimized: boolean
}

export type WindowActivationAction = 'open' | 'reveal' | 'none'

export function resolveWindowActivationAction(
  state: WindowActivationState
): WindowActivationAction {
  if (state.windowCount === 0) return 'open'
  if (!state.mainWindowVisible || state.mainWindowMinimized) return 'reveal'
  return 'none'
}
