import { app, nativeImage } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import { renderDesignSample } from './design-sample-service'

/** Explicit opt-in packaging probe; no model invocation or user session mutations. */
export async function verifyDesignSample(directory: string) {
  await mkdir(directory, { recursive: true })
  const png = await renderDesignSample('png')
  const reopened = await renderDesignSample('png')
  assert.deepEqual(reopened, png, 'Reopening must reproduce the saved sample')
  const jpeg = await renderDesignSample('jpeg')
  for (const [format, bytes] of [
    ['png', png],
    ['jpg', jpeg]
  ] as const) {
    const decoded = nativeImage.createFromBuffer(bytes)
    assert.deepEqual(decoded.getSize(), { width: 800, height: 600 })
    const pixel = decoded.toBitmap().subarray(0, 4)
    if (format === 'png') assert.equal(pixel[3], 0, 'PNG corner must remain transparent')
    else assert.ok(pixel[0] > 250 && pixel[1] > 250 && pixel[2] > 250, 'JPEG corner must be white')
    await writeFile(join(directory, `sample.${format}`), bytes)
  }
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        packaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        dimensions: [800, 600],
        reopen: 'identical',
        png: 'transparent',
        jpeg: 'white'
      },
      null,
      2
    ) + '\n'
  )
}
