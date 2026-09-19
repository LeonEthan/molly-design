import type { WebContentsView } from 'electron'

type Viewport = { scale: number; x: number; y: number }
const pending = new Map<string, Promise<Viewport | undefined>>()

/** Only the visible surface owns the user's camera; hidden copies cannot overwrite it. */
export function rememberDesignViewport(hostId: string, view: WebContentsView) {
  const bounds = view.getBounds()
  if (
    !view.getVisible() ||
    view.webContents.isDestroyed() ||
    bounds.x + bounds.width <= 0 ||
    bounds.y + bounds.height <= 0
  )
    return undefined
  const captured = view.webContents
    .executeJavaScript('window.bento?.viewport?.()')
    .then((value: Viewport | undefined) =>
      value && [value.scale, value.x, value.y].every(Number.isFinite) && value.scale > 0
        ? value
        : undefined
    )
    .catch(() => undefined)
  pending.set(hostId, captured)
  return captured
}

export async function restoreDesignViewport(hostId: string, view: WebContentsView) {
  // Electron's setBounds is asynchronous with respect to renderer layout. Wait
  // for the actual viewport and force layout before deriving a fit scale.
  // Hidden BrowserWindows do not deliver animation frames.
  const bounds = view.getBounds()
  const { width, height } = bounds
  if (!view.getVisible()) view.setVisible(true)
  await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(Error('Canvas layout timed out: ' + innerWidth + 'x' + innerHeight + ' expected ${width}x${height}')); }, 5000);
    function cleanup() { clearTimeout(timer); clearInterval(poll); window.removeEventListener('resize', check); }
    function check() {
      if (innerWidth !== ${width} || innerHeight !== ${height}) return;
      document.body.getBoundingClientRect(); cleanup(); resolve(true);
    }
    const poll = setInterval(check, 16);
    window.addEventListener('resize', check); check();
  })`)
  const captured = pending.get(hostId)
  const value = captured ? await captured : undefined
  if (view.webContents.isDestroyed()) return
  if (value && pending.get(hostId) === captured)
    await view.webContents.executeJavaScript(`window.bento?.viewport?.(${JSON.stringify(value)})`)
  if (pending.get(hostId) === captured) pending.delete(hostId)
}
