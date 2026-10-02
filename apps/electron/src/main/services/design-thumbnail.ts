import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { designRequest, renderSavedDesign } from './design-service'
import { DesignThumbnails, type DesignThumbnail } from './design-thumbnail-core'

const THUMBNAIL_SHORT_EDGE_PX = 48

const cacheDirectory = () => join(app.getPath('userData'), 'design-thumbnails')
const cacheFile = (artworkId: string) => join(cacheDirectory(), `${artworkId}.json`)

async function readCached(artworkId: string): Promise<DesignThumbnail | undefined> {
  try {
    const value = JSON.parse(await readFile(cacheFile(artworkId), 'utf8')) as DesignThumbnail
    return typeof value.revisionId === 'string' && value.dataUrl.startsWith('data:image/png;')
      ? value
      : undefined
  } catch {
    return undefined
  }
}

async function writeCached(artworkId: string, thumbnail: DesignThumbnail): Promise<void> {
  await mkdir(cacheDirectory(), { recursive: true })
  const temporary = join(cacheDirectory(), `.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(thumbnail))
    } finally {
      await file.close()
    }
    await rename(temporary, cacheFile(artworkId))
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

const thumbnails = new DesignThumbnails({
  readSaved: (artworkId) => designRequest({ operation: 'read', sessionId: artworkId }),
  render: async (saved) => {
    const image = nativeImage.createFromBuffer(await renderSavedDesign(saved, 'png'))
    const { width, height } = image.getSize()
    const scale = Math.min(1, THUMBNAIL_SHORT_EDGE_PX / Math.min(width, height))
    return image
      .resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'best'
      })
      .toDataURL()
  },
  readCached,
  writeCached
})

export const getDesignThumbnail = (artworkId: string) => thumbnails.get(artworkId)

/** Refresh in the background after the person leaves the canvas, then tell rows to re-read. */
export function refreshDesignThumbnailAfterLeave(artworkId: string) {
  void thumbnails.refresh(artworkId).then(
    () => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.webContents.send('design.thumbnail', { artworkId })
    },
    () => {}
  )
}

export const refreshDesignThumbnail = (artworkId: string) => thumbnails.refresh(artworkId)

export const forgetDesignThumbnail = (artworkId: string) =>
  rm(cacheFile(artworkId), { force: true })
