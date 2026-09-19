import type { WebContentsView } from 'electron'

// Native instances retain manual zoom while hidden. A new document instance or
// changed container dimensions needs a fresh fit, never the previous document's scale.
const fittedBounds = new WeakMap<WebContentsView, { width: number; height: number }>()

export async function fitDesignViewport(view: WebContentsView) {
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
  if (view.webContents.isDestroyed()) return
  const fitted = fittedBounds.get(view)
  if (fitted?.width !== width || fitted.height !== height) {
    await view.webContents.executeJavaScript('window.bento.fit()')
    fittedBounds.set(view, { width, height })
  }
}
