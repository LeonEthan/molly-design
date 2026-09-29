import type { WebContentsView } from 'electron'

// Native instances retain manual zoom while hidden. A new document instance or
// changed container dimensions needs a fresh fit, never the previous document's scale.
const fittedBounds = new WeakMap<WebContentsView, { width: number; height: number }>()
type ViewportFit = {
  width: number
  height: number
  promise: Promise<void>
  replacement?: Promise<void>
}
const pendingFits = new WeakMap<WebContentsView, ViewportFit>()

export async function fitDesignViewport(view: WebContentsView): Promise<void> {
  const { width, height } = view.getBounds()
  const previous = pendingFits.get(view)
  if (previous?.width === width && previous.height === height) return previous.promise
  const pending: ViewportFit = { width, height, promise: Promise.resolve() }
  pendingFits.set(view, pending)
  pending.promise = fitCurrentViewport(view, pending)
  if (previous) previous.replacement = pending.promise
  return pending.promise
}

async function fitCurrentViewport(view: WebContentsView, pending: ViewportFit): Promise<void> {
  // Electron's setBounds is asynchronous with respect to renderer layout. Wait
  // for the actual viewport and force layout before deriving a fit scale.
  // Hidden BrowserWindows do not deliver animation frames.
  const { width, height } = pending
  try {
    if (!view.getVisible()) view.setVisible(true)
    await view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    window.__mollyCancelViewportLayout?.();
    const timer = setTimeout(() => { cleanup(); reject(Error('Canvas layout timed out: ' + innerWidth + 'x' + innerHeight + ' expected ${width}x${height}')); }, 5000);
    function cleanup() {
      clearTimeout(timer); clearInterval(poll); window.removeEventListener('resize', check);
      if (window.__mollyCancelViewportLayout === supersede) delete window.__mollyCancelViewportLayout;
    }
    function supersede() { cleanup(); resolve(false); }
    function check() {
      if (innerWidth !== ${width} || innerHeight !== ${height}) return;
      document.body.getBoundingClientRect(); cleanup(); resolve(true);
    }
    const poll = setInterval(check, 16);
    window.__mollyCancelViewportLayout = supersede;
    window.addEventListener('resize', check); check();
  })`)
    if (pending.replacement) return await pending.replacement
    if (view.webContents.isDestroyed()) return
    const fitted = fittedBounds.get(view)
    if (fitted?.width !== width || fitted.height !== height) {
      fittedBounds.delete(view)
      await view.webContents.executeJavaScript('window.bento.fit()')
      if (pending.replacement) return await pending.replacement
      fittedBounds.set(view, { width, height })
    }
  } catch (error) {
    if (pending.replacement) return await pending.replacement
    throw error
  } finally {
    if (pendingFits.get(view) === pending) pendingFits.delete(view)
  }
}
