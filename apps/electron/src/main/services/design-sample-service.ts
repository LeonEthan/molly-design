import { app, BrowserWindow, dialog, protocol } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { acquireDesignSession } from './design-session'

const run = promisify(execFile)
const resourceRoot = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked/resources')
    : join(app.getAppPath(), 'resources')
const resourceDirectory = () => join(resourceRoot(), 'design')

export function registerDesignSampleScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'molly-design', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

// Same patched Bento stage as production-render; only the Electron transport differs.
const prepareStage = `new Promise((resolve, reject) => {
  const timer = setTimeout(() => { observer.disconnect(); reject(Error('Bento readiness timed out')); }, 30000);
  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true });
  async function check() {
    const slide = document.querySelector('.ed-stage-scale .bento-slide');
    if (!window.bento?.doc || !slide) return;
    observer.disconnect();
    try {
      await document.fonts.ready;
      const faces = [...document.fonts].filter(face => face.family.replaceAll('"', '') === 'Space Mono');
      if (!faces.length || faces.some(face => face.status !== 'loaded')) throw Error('Sample font failed to load');
      await Promise.all([...slide.querySelectorAll('img')].map(image => image.decode()));
      await Promise.all([...slide.querySelectorAll('image')].map(node => {
        const image = new Image(); image.src = node.getAttribute('href') || node.getAttribute('xlink:href') || '';
        return image.decode();
      }));
      if (slide.offsetWidth !== 800 || slide.offsetHeight !== 600) throw Error('Bento canvas dimensions differ');
      const style = document.createElement('style');
      style.textContent = 'html,body{margin:0!important;padding:0!important;background:transparent!important;overflow:hidden!important}';
      document.head.append(style);
      slide.style.transform = 'none';
      slide.style.position = 'absolute'; slide.style.left = '0'; slide.style.top = '0';
      slide.inert = true;
      document.body.replaceChildren(slide);
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      clearTimeout(timer); resolve(true);
    } catch (error) { clearTimeout(timer); reject(error); }
  }
  check();
})`

async function createSampleWindow(show: boolean) {
  const resources = resourceDirectory()
  const { stdout } = await run(
    process.execPath,
    [
      join(resourceRoot(), 'cli/design-sample.js'),
      JSON.stringify({ operation: 'open-sample', resources })
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    }
  )
  const payload: unknown = JSON.parse(stdout)
  const shell = await readFile(join(resources, 'editor.html'))
  const manifest = JSON.parse(await readFile(join(resources, 'build.json'), 'utf8'))
  if (createHash('sha256').update(shell).digest('hex') !== manifest.shellSha256) {
    throw new Error('Bento resource integrity failure')
  }
  const lease = await acquireDesignSession()
  const isolated = lease.session
  const host = 'sample-' + randomUUID()
  const origin = 'molly-design://' + host
  try {
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: !details.url.startsWith(`${origin}/`) && !/^(data|blob):/.test(details.url)
      })
    })
    await isolated.protocol.handle('molly-design', (request) =>
      lease.run(() => {
        const url = new URL(request.url)
        if (request.method !== 'GET' || url.protocol !== 'molly-design:' || url.host !== host)
          return new Response(null, { status: 403 })
        const headers = {
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self' data:; worker-src blob:; base-uri 'none'; form-action 'none'"
        }
        if (url.pathname === '/editor.html')
          return new Response(shell, { headers: { ...headers, 'Content-Type': 'text/html' } })
        if (url.pathname === '/ws/molly-p0') return Response.json(payload, { headers })
        return new Response(null, { status: 404 })
      })
    )
    const window = lease.own(
      () =>
        new BrowserWindow({
          width: 800,
          height: 600,
          useContentSize: true,
          show: false,
          title: 'Molly — Sample',
          backgroundColor: '#00000000',
          transparent: true,
          resizable: false,
          webPreferences: {
            session: isolated,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
          }
        })
    )
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.on('closed', () => {
      lease.dispose()
    })
    try {
      await window.loadURL(`${origin}/editor.html?ws=molly-p0`)
      await window.webContents.executeJavaScript(prepareStage)
      if (show) window.show()
      return window
    } catch (error) {
      window.destroy()
      throw error
    }
  } catch (error) {
    lease.dispose()
    throw error
  }
}

export async function openDesignSampleWindow() {
  await createSampleWindow(true)
}

export async function renderDesignSample(format: 'png' | 'jpeg'): Promise<Buffer> {
  const window = await createSampleWindow(false)
  try {
    if (format === 'jpeg') {
      await window.webContents.executeJavaScript(
        "document.documentElement.style.setProperty('background', '#fff', 'important'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
      )
    }
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 800, height: 600 })
    const exact = image.resize({ width: 800, height: 600 })
    return format === 'png' ? exact.toPNG() : exact.toJPEG(95)
  } finally {
    window.destroy()
  }
}

export async function exportDesignSample(format: 'png' | 'jpeg') {
  const result = await dialog.showSaveDialog({
    defaultPath: `MollyDesign-sample.${format === 'jpeg' ? 'jpg' : 'png'}`,
    filters: [{ name: format.toUpperCase(), extensions: [format === 'jpeg' ? 'jpg' : 'png'] }]
  })
  if (result.canceled || !result.filePath) return
  const bytes = await renderDesignSample(format)
  const temporary = `${result.filePath}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, result.filePath)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export function reportDesignSampleError(error: unknown) {
  dialog.showErrorBox('Molly', error instanceof Error ? error.message : String(error))
}
