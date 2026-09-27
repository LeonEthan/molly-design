import { screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import Conf from 'conf'
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  fitBoundsToWorkArea,
  resolveDefaultMainWindowBounds
} from './window-default-bounds'

const WINDOW_STATE_DEBOUNCE_MS = 150
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 120

type PersistedWindowBounds = {
  width: number
  height: number
  x?: number
  y?: number
}

type PersistedWindowState = {
  bounds: PersistedWindowBounds
  isMaximized: boolean
}

type WindowStateSchema = {
  mainWindow?: PersistedWindowState
}

const normalizedConfModule = Conf as
  | typeof Conf
  | {
      default?: typeof Conf
    }

const ConfConstructor =
  typeof normalizedConfModule === 'function' ? normalizedConfModule : normalizedConfModule.default

if (typeof ConfConstructor !== 'function') {
  throw new TypeError('Unable to initialize config store: invalid Conf module export shape.')
}

const windowStateStore = new ConfConstructor<WindowStateSchema>({
  projectName: 'molly-desktop',
  configName: 'window-state',
  schema: {
    mainWindow: {
      type: 'object',
      additionalProperties: false,
      required: ['bounds', 'isMaximized'],
      properties: {
        bounds: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: {
            width: { type: 'number', minimum: MIN_VISIBLE_WIDTH },
            height: { type: 'number', minimum: MIN_VISIBLE_HEIGHT },
            x: { type: 'number' },
            y: { type: 'number' }
          }
        },
        isMaximized: { type: 'boolean' }
      }
    }
  }
})

function roundCoordinate(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(value)
}

function getDefaultMainWindowBounds(): PersistedWindowBounds {
  return resolveDefaultMainWindowBounds(screen.getPrimaryDisplay().workArea)
}

function normalizeBounds(bounds: PersistedWindowBounds): PersistedWindowBounds {
  const hasFiniteSize = Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
  if (!hasFiniteSize) {
    return getDefaultMainWindowBounds()
  }
  const width = Math.max(Math.round(bounds.width), MAIN_WINDOW_MIN_WIDTH)
  const height = Math.max(Math.round(bounds.height), MAIN_WINDOW_MIN_HEIGHT)

  return {
    width,
    height,
    x: roundCoordinate(bounds.x),
    y: roundCoordinate(bounds.y)
  }
}

function ensureVisibleBounds(bounds: PersistedWindowBounds): PersistedWindowBounds {
  return fitBoundsToWorkArea(
    bounds,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea
  )
}

function getMainWindowState(): PersistedWindowState {
  const savedState = windowStateStore.get('mainWindow')
  if (savedState === undefined) {
    return { bounds: getDefaultMainWindowBounds(), isMaximized: false }
  }
  const normalizedBounds = ensureVisibleBounds(normalizeBounds(savedState.bounds))

  return {
    bounds: normalizedBounds,
    isMaximized: savedState.isMaximized
  }
}

export function getMainWindowConstructorOptions(): Pick<
  BrowserWindowConstructorOptions,
  'width' | 'height' | 'x' | 'y' | 'minWidth' | 'minHeight'
> {
  const state = getMainWindowState()

  return {
    width: state.bounds.width,
    height: state.bounds.height,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    ...(state.bounds.x !== undefined ? { x: state.bounds.x } : {}),
    ...(state.bounds.y !== undefined ? { y: state.bounds.y } : {})
  }
}

export function shouldMaximizeMainWindowOnLaunch(): boolean {
  return getMainWindowState().isMaximized
}

function saveMainWindowState(window: BrowserWindow): void {
  const bounds = normalizeBounds(
    window.isMaximized() || window.isMinimized() || window.isFullScreen()
      ? window.getNormalBounds()
      : window.getBounds()
  )

  windowStateStore.set('mainWindow', {
    bounds,
    isMaximized: window.isMaximized()
  })
}

export function trackMainWindowState(window: BrowserWindow): void {
  let persistTimer: NodeJS.Timeout | null = null

  const scheduleSave = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer)
    }

    persistTimer = setTimeout(() => {
      persistTimer = null
      if (!window.isDestroyed()) {
        saveMainWindowState(window)
      }
    }, WINDOW_STATE_DEBOUNCE_MS)
  }

  window.on('move', scheduleSave)
  window.on('resize', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    saveMainWindowState(window)
  })
}
