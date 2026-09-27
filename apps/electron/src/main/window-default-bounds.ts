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

export type SavedWindowBounds = {
  width: number
  height: number
  x?: number
  y?: number
}

function intersectionArea(bounds: WorkArea, workArea: WorkArea): number {
  const width =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
  const height =
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
    Math.max(bounds.y, workArea.y)
  return width > 0 && height > 0 ? width * height : 0
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function fitBoundsToWorkArea(
  bounds: SavedWindowBounds,
  workAreas: readonly WorkArea[],
  primaryWorkArea: WorkArea
): SavedWindowBounds {
  const { x, y } = bounds
  const target =
    x === undefined || y === undefined
      ? primaryWorkArea
      : workAreas.reduce<{ workArea: WorkArea; area: number }>(
          (best, workArea) => {
            const area = intersectionArea(
              { x, y, width: bounds.width, height: bounds.height },
              workArea
            )
            return area > best.area ? { workArea, area } : best
          },
          { workArea: primaryWorkArea, area: 0 }
        ).workArea
  const width = Math.max(Math.min(bounds.width, target.width), MAIN_WINDOW_MIN_WIDTH)
  const height = Math.max(Math.min(bounds.height, target.height), MAIN_WINDOW_MIN_HEIGHT)

  if (x === undefined || y === undefined) {
    return { width, height }
  }

  return {
    width,
    height,
    x: clampToRange(x, target.x, target.x + target.width - width),
    y: clampToRange(y, target.y, target.y + target.height - height)
  }
}
