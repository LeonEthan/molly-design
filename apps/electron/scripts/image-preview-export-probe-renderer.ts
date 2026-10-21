import { runImagePreviewContextMenu } from '../../../packages/components/src/lib/image-preview-export'

async function run() {
  const ipc = window.ipc!
  const fixtures: { name: string; mime: string; base64: string }[] =
    await ipc.invoke('probe.fixtures')
  for (const fixture of fixtures) {
    const bytes = Uint8Array.from(atob(fixture.base64), (value) => value.charCodeAt(0))
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: fixture.mime }))
    try {
      for (const src of [
        `data:${fixture.mime};base64,${fixture.base64}`,
        blobUrl,
        `molly-resource://file/${fixture.name}`
      ]) {
        for (const action of ['copy', 'save']) {
          await ipc.invoke('probe.action', action)
          const outcome = await runImagePreviewContextMenu({
            src,
            fileName: `original.${fixture.name}`,
            items: [
              { action: 'copy', label: 'Copy Image' },
              { action: 'save', label: 'Save Image As…' }
            ]
          })
          const expected = action === 'copy' ? 'copied' : 'saved'
          if (outcome.kind !== expected)
            throw new Error(`${src.split(':')[0]}/${fixture.name}: ${JSON.stringify(outcome)}`)
          await ipc.invoke('probe.verify', fixture.name, src.split(':')[0])
        }
      }
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }
}

void run().then(
  () => window.ipc!.invoke('probe.done'),
  (error: unknown) => window.ipc!.invoke('probe.done', String(error))
)
