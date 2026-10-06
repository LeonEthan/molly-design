import type { BrowserWindow, WebContentsView } from 'electron'
import { waitForCanvasReady } from './design-canvas-ready-core'

export async function captureDesignViewFrame(view: WebContentsView, current: () => boolean) {
  if (!current() || view.webContents.isDestroyed() || !view.getVisible()) return null
  const bounds = view.getBounds()
  if (bounds.width * bounds.height > 16_777_216) throw Error('Canvas frame is too large')
  const frame = await view.webContents.capturePage(undefined, { stayHidden: true })
  if (!current() || view.webContents.isDestroyed()) return null
  const latest = view.getBounds()
  if (latest.width !== bounds.width || latest.height !== bounds.height) return null
  if (frame.isEmpty()) throw Error('Canvas frame is unavailable')
  const png = frame.toPNG()
  if (png.byteLength > 32 * 1024 * 1024) throw Error('Canvas frame is too large')
  return { src: `data:image/png;base64,${png.toString('base64')}`, ...bounds }
}

/** Prepare pixels underneath the outgoing native view; never expose a loading surface. */
export async function prepareDesignFrame(view: WebContentsView, owner: BrowserWindow) {
  await waitForCanvasReady(
    async () => {
      await view.webContents.executeJavaScript(`(async () => {
    document.body.getBoundingClientRect();
    await document.fonts.ready;
    if ([...document.fonts].some(font => font.status === 'error')) throw Error('Canvas font failed to load');
    const images = [...document.querySelectorAll('.bento-slide img')];
    for (const node of document.querySelectorAll('.bento-slide image')) {
      const image = new Image();
      image.src = node.getAttribute('href') || node.getAttribute('xlink:href') || '';
      images.push(image);
    }
    await Promise.all(images.map(image => image.decode()));
    document.body.getBoundingClientRect();
  })()`)
      // Hidden/minimized windows have no display surface. Resource preparation still
      // completes there; there is no visible handoff to gate until the window returns.
      if (!owner.isVisible() || owner.isMinimized() || !view.getVisible()) return
      await view.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
      )
      if (!owner.isVisible() || owner.isMinimized() || !view.getVisible()) return
      // A renderer layout/DOM acknowledgement does not imply raster completion.
      // Request a compositor copy after layout and decoding, keeping hidden hosts hidden.
      // This is pixel readiness, not a claim that the OS has presented a frame.
      const frame = await view.webContents.capturePage(undefined, { stayHidden: true })
      if (frame.isEmpty()) throw Error('Canvas frame is not ready')
    },
    { timeoutMs: 30000 }
  )
}
