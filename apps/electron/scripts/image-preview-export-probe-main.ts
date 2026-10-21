import assert from 'node:assert/strict'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  ipcMain,
  nativeImage,
  protocol
} from 'electron'
import { copyImageToClipboard } from '../src/main/services/image-export-service'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'molly-resource',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
app.setPath('userData', path.join(__dirname, 'profile'))

void app.whenReady().then(async () => {
  let restore: ClipboardItem[] | undefined
  let status = 1
  const finish = async () => {
    try {
      if (restore) await clipboard.write(restore)
    } catch (error) {
      console.error(error)
      status = 1
    } finally {
      app.exit(status)
    }
  }
  try {
    const previous = await clipboard.read()
    restore = await Promise.all(
      previous.map(
        async (item) =>
          new ClipboardItem(
            Object.fromEntries(
              await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))
            )
          )
      )
    )
    const size = { width: 1600, height: 900 }
    const source = nativeImage.createFromBitmap(
      Buffer.alloc(size.width * size.height * 4, 127),
      size
    )
    const fixtures = {
      png: { mime: 'image/png', bytes: source.toPNG() },
      jpeg: { mime: 'image/jpeg', bytes: source.toJPEG(90) }
    }
    let action: 'copy' | 'save' = 'copy'
    let saved: Buffer | undefined
    protocol.handle('molly-resource', (request) => {
      const fixture = fixtures[new URL(request.url).pathname.slice(1) as keyof typeof fixtures]
      return new Response(new Uint8Array(fixture.bytes), {
        headers: { 'Content-Type': fixture.mime, 'Access-Control-Allow-Origin': '*' }
      })
    })
    ipcMain.handle('probe.fixtures', () =>
      Object.entries(fixtures).map(([name, fixture]) => ({
        name,
        mime: fixture.mime,
        base64: fixture.bytes.toString('base64')
      }))
    )
    ipcMain.handle('probe.action', (_event, next: typeof action) => {
      action = next
      saved = undefined
      if (action === 'copy') clipboard.clear()
    })
    ipcMain.handle('image.showPreviewMenu', () => ({ action }))
    ipcMain.handle('image.copyToClipboard', (_event, input: { pngBytes: ArrayBuffer }) =>
      copyImageToClipboard(input.pngBytes)
    )
    ipcMain.handle('image.saveAs', (_event, input: { bytes: ArrayBuffer }) => {
      saved = Buffer.from(input.bytes)
      return { saved: true, path: '/synthetic/image' }
    })
    ipcMain.handle('probe.verify', async (_event, name: keyof typeof fixtures, scheme: string) => {
      if (action === 'copy') {
        const item = (await clipboard.read()).find((item) => item.types.includes('image/png'))
        assert.ok(item, `${scheme}/${name}: no PNG on the system clipboard`)
        const blob = await item.getType('image/png')
        assert.deepEqual(
          nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize(),
          size
        )
      } else {
        assert.deepEqual(saved, fixtures[name].bytes)
      }
      console.log(`${scheme}/${name}: ${action} passed`)
    })
    ipcMain.handle('probe.done', async (_event, error?: string) => {
      if (error) console.error(error)
      status = error ? 1 : 0
      await finish()
    })
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true
      }
    })
    await window.loadFile(path.join(__dirname, 'index.html'))
  } catch (error) {
    console.error(error)
    await finish()
  }
})
