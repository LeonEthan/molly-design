export type WorkArea = {
  x: number
  y: number
  width: number
  height: number
}

export type DefaultWindowBounds = WorkArea

export const MAIN_WINDOW_MIN_WIDTH = 620
export const MAIN_WINDOW_MIN_HEIGHT = 600

const DEFAULT_WORK_AREA_SHARE = 0.8
const DEFAULT_WIDTH_RANGE = { min: 1180, max: 1600 } as const
const DEFAULT_HEIGHT_RANGE = { min: 780, max: 1000 } as const

function resolveDefaultLength(
  available: number,
  range: { min: number; max: number },
  minimum: number
): number {
  const preferred = Math.min(
    Math.max(Math.round(available * DEFAULT_WORK_AREA_SHARE), range.min),
    range.max
  )
  return Math.max(Math.min(preferred, Math.floor(available)), minimum)
}

export function resolveDefaultMainWindowBounds(workArea: WorkArea): DefaultWindowBounds {
  const width = resolveDefaultLength(workArea.width, DEFAULT_WIDTH_RANGE, MAIN_WINDOW_MIN_WIDTH)
  const height = resolveDefaultLength(workArea.height, DEFAULT_HEIGHT_RANGE, MAIN_WINDOW_MIN_HEIGHT)

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + Math.max(workArea.height - height, 0) / 2)
  }
}
