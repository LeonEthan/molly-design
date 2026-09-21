import { createProductSession } from './packages/editor-bento/src/boot/product-session.ts'
import { createElementCommand, imageCreateElementCommand } from './packages/editor-bento/src/ui/create-delete.ts'
import { nextElementId } from './packages/editor-bento/src/ui/defaults.ts'
import { pickImageFile } from './packages/editor-bento/src/ui/dom/image.ts'
// A1a-2 composition root（docs/a1a-2-acceptance.md §3/§5）。
// 页面以 ?ws=<id> 启动时接管 boot：从同源 test server 取 semantic BentoDocV4 +
// 资产 dataURI 表，建 kernel + bridge（packages 源码拷入本目录 packages/），
// projectToBentoNative 单向投影为 native 视图文档。semantic kernel 是 canonical
// 唯一权威；永不 native→semantic 回写——成功命令后从 semantic snapshot 重新投影。

import {
  BentoVisualBridge,
  createRecordingVisualDocumentKernel,
  type RecordingVisualDocumentKernel,
} from './packages/editor-bento/src/bridge.ts'
import { projectToBentoNative } from './packages/editor-bento/src/project.ts'
import { injectTextParagraphNormalizationCss } from './packages/editor-bento/src/renderers/text.ts'
import type { BentoDocV4, VisualCommandV4 } from './packages/contracts/src/index.ts'
import { STATIC_V1_TEXT_DEFAULTS } from './packages/contracts/src/index.ts'

export interface A1a2Session {
  /** 投影后的 native 文档，交给 bootWith 建 Store。 */
  readonly nativeDoc: unknown
  readonly bridge: BentoVisualBridge
  readonly kernel: RecordingVisualDocumentKernel
  /** editorMode 建 Store 后回接，供 bridge 成功命令后的视图刷新。 */
  attachStore(store: { replaceViewDoc(next: unknown): void; setDirty(dirty: boolean): void; readonly selection: string[]; select(ids: string[]): void; on(event: 'selection', callback: () => void): () => void }, commitPending: () => void): void
  /** 登记新资产字节（setAsset 前置）；key 为调用方算好的内容 sha256 hex。 */
  registerAsset(key: string, dataUri: string): void
  /** 保存 = semantic canonical JSON + 全量资产表 POST /ws/<id>/save。 */
  save(): Promise<{ ok: boolean; error?: string }>
}

interface WorkspacePayload {
  doc: BentoDocV4
  assets: Record<string, string>
  revisionId?: string | null
}

export async function bootA1a2Workspace(wsId: string): Promise<A1a2Session> {
  // text.paragraphMargin 行：UA 1em 段距规范化（投影段落为 <p>，vendor
  // sanitizeHtml 剥 inline style）。规则定义在项目侧 renderers/text.ts，此处
  // 只做 host 装配调用（composition-root bound；patch 零语义）。
  injectTextParagraphNormalizationCss()
  const response = await fetch(`/ws/${encodeURIComponent(wsId)}`)
  if (!response.ok) throw new Error(`workspace fetch failed: HTTP ${response.status}`)
  const payload = (await response.json()) as WorkspacePayload

  // 资产表：初始 workspace 资产 + 编辑期 registerAsset 新增；投影的唯一解析源。
  const assetRegistry = new Map<string, string>(Object.entries(payload.assets))
  const resolveAsset = (ref: string): string => {
    const key = ref.startsWith('asset:') ? ref.slice('asset:'.length) : ref
    const dataUri = assetRegistry.get(key)
    if (dataUri === undefined) throw new Error(`unresolvable asset reference: ${ref}`)
    return dataUri
  }

  const kernel = createRecordingVisualDocumentKernel(payload.doc)
  let product: ReturnType<typeof createProductSession> | undefined
  let view: { replaceViewDoc(next: unknown): void } | null = null
  const bridge = new BentoVisualBridge(kernel, (snapshot) => {
    view?.replaceViewDoc(
      projectToBentoNative(JSON.parse(snapshot) as BentoDocV4, { resolveAsset }),
    )
    product?.changed()
  })

  return {
    nativeDoc: projectToBentoNative(payload.doc, { resolveAsset }),
    bridge,
    kernel,
    attachStore(store, commitPending) {
      view = store
      if (new URLSearchParams(location.search).get('autosave') === '1') {
        if (typeof payload.revisionId !== 'string') throw new Error('Product workspace requires a revision')
        const doc = () => JSON.parse(kernel.snapshot()) as BentoDocV4
        const selectedElements = () => {
          const byId = new Map(doc().elements.map((element) => [element.id, element]))
          return store.selection.flatMap((id) => {
            const element = byId.get(id)
            return element ? [element] : []
          })
        }
        const horizontalAlign = (value: string | undefined) =>
          value === 'left' || value === 'center' || value === 'right' || value === 'justify' ? value : undefined
        const solidFill = (fill: BentoDocV4['background'] | undefined) =>
          fill === undefined ? null : fill.type === 'solid' ? fill.color : undefined
        const selectionEntry = (element: BentoDocV4['elements'][number]) => ({
          id: element.id,
          kind: element.kind,
          x: element.bounds[0],
          y: element.bounds[1],
          width: element.bounds[2],
          height: element.bounds[3],
          ...(element.kind === 'text'
            ? (() => {
                const firstRun = element.text.paragraphs?.flatMap((paragraph) => paragraph.runs ?? [])[0]
                return {
                  color: element.text.color || firstRun?.color || STATIC_V1_TEXT_DEFAULTS.color,
                  // Omitted (or empty) text style resolves to the pinned product
                  // default at projection time; surface the effective values so
                  // the toolbar never renders an empty/indeterminate control.
                  fontFamily: (typeof element.text.fontFamily === 'string' ? element.text.fontFamily : (element.text.fontFamily?.latin || (typeof firstRun?.fontFamily === 'string' ? firstRun.fontFamily : firstRun?.fontFamily?.latin))) || STATIC_V1_TEXT_DEFAULTS.fontFamily,
                  fontSize: element.text.fontSize ?? firstRun?.fontSize ?? STATIC_V1_TEXT_DEFAULTS.fontSize,
                  bold: element.text.bold ?? firstRun?.bold,
                  italic: element.text.italic ?? firstRun?.italic,
                  alignH: horizontalAlign(element.text.align?.[0]),
                }
              })()
            : {}),
          ...(element.kind === 'shape' || element.kind === 'icon' ? { fill: solidFill(element.fill) } : {}),
          ...(element.kind === 'shape' || element.kind === 'line'
            ? { borderColor: element.border?.color ?? null, borderWidth: element.border?.width }
            : {}),
          ...(element.kind === 'image' ? { fit: element.fit, crop: element.crop } : {}),
          ...(element.kind === 'line'
            ? { arrowStart: element.arrow?.[0] ?? null, arrowEnd: element.arrow?.[1] ?? null }
            : {}),
        })
        const selectionSummary = () => {
          const elements = selectedElements()
          return {
            count: elements.length,
            kinds: [...new Set(elements.map((element) => element.kind))],
            // Usable families = pinned product default + registered custom fonts;
            // both are registration-optional in the kernel contract.
            fonts: [...new Set([STATIC_V1_TEXT_DEFAULTS.fontFamily, ...(doc().fonts ?? []).map((font) => font.family)])],
            ...(elements.length <= 8 ? { elements: elements.map(selectionEntry) } : {}),
          }
        }
        const pushSelection = () => {
          const selected = selectedElements().map((element) => ({
            id: element.id,
            type: element.kind,
            preview: element.kind === 'text'
              ? element.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
              : '',
          }))
          product!.selection(selected, selectionSummary())
        }
        const applyCommands = (input: any) => {
          if (input?.verb === 'add-element') {
            // Creation does not fan out over the selection: build one closed-world
            // default element from the shared factory, override per payload.
            const canvas = doc().canvas
            let command: VisualCommandV4 | undefined
            if (input.kind === 'text' || input.kind === 'line') {
              command = createElementCommand(input.kind, nextElementId(input.kind.slice(0, 3)), canvas)[0]
            } else if (input.kind === 'shape') {
              command = createElementCommand('shape', nextElementId('sha'), canvas)[0]
              if (command?.type === 'createElement' && command.element.kind === 'shape' && typeof input.shapeName === 'string')
                command.element.shapeName = input.shapeName
            } else if (input.kind === 'image' && typeof input.src === 'string') {
              command = imageCreateElementCommand(nextElementId('img'), canvas, input.src)[0]
              const naturalWidth = Number(input.naturalWidth)
              const naturalHeight = Number(input.naturalHeight)
              if (command?.type === 'createElement' && naturalWidth > 0 && naturalHeight > 0) {
                const scale = Math.min(1, (canvas.width * 0.6) / naturalWidth, (canvas.height * 0.6) / naturalHeight)
                const width = Math.max(1, Math.round(naturalWidth * scale))
                const height = Math.max(1, Math.round(naturalHeight * scale))
                command.element.bounds = [Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height]
              }
            }
            if (!command) return { ok: false, error: 'No matching elements' }
            const result = bridge.dispatch([command])
            if (!result.ok) return { ok: false, error: result.error.message }
            if (command.type === 'createElement') store.select([command.element.id])
            pushSelection()
            return { ok: true, applied: 1 }
          }
          const commands: VisualCommandV4[] = []
          for (const element of selectedElements()) {
            switch (input?.verb) {
              case 'text-style': {
                if (element.kind !== 'text') break
                // Whole-element text edits rewrite the full content via setText
                // (upstream D2 route): set the element-level field and drop the
                // same key from every run, so run-level overrides cannot keep
                // rendering the old value after a command reports success.
                const text = structuredClone(element.text)
                let changed = false
                const applyField = (key: 'color' | 'fontFamily' | 'fontSize' | 'bold' | 'italic', value: string | number | boolean) => {
                  ;(text as unknown as Record<string, unknown>)[key] = value
                  for (const paragraph of text.paragraphs ?? [])
                    for (const run of paragraph.runs ?? []) delete (run as unknown as Record<string, unknown>)[key]
                  changed = true
                }
                if (typeof input.color === 'string') applyField('color', input.color)
                if (typeof input.fontFamily === 'string') applyField('fontFamily', input.fontFamily)
                if (typeof input.fontSize === 'number') applyField('fontSize', input.fontSize)
                if (typeof input.bold === 'boolean') applyField('bold', input.bold)
                if (typeof input.italic === 'boolean') applyField('italic', input.italic)
                if (typeof input.alignH === 'string') {
                  text.align = [input.alignH, element.text.align?.[1] ?? 'top']
                  changed = true
                }
                if (changed) commands.push({ type: 'setText', targetId: element.id, text })
                break
              }
              case 'fill': {
                if (element.kind !== 'shape' && element.kind !== 'icon') break
                commands.push({
                  type: 'setStyle',
                  targetId: element.id,
                  patch: { fill: typeof input.fill === 'string' ? { type: 'solid', color: input.fill } : null },
                })
                break
              }
              case 'border': {
                if (element.kind !== 'shape' && element.kind !== 'line') break
                commands.push({
                  type: 'setBorder',
                  targetId: element.id,
                  border:
                    input.color === null
                      ? null
                      : {
                          style: element.border?.style ?? 'solid',
                          color: input.color,
                          width: input.width ?? element.border?.width,
                        },
                })
                break
              }
              case 'size': {
                commands.push({
                  type: 'setBounds',
                  targetId: element.id,
                  bounds: [element.bounds[0], element.bounds[1], input.width, input.height],
                })
                break
              }
              case 'position': {
                commands.push({
                  type: 'setBounds',
                  targetId: element.id,
                  bounds: [input.x, input.y, element.bounds[2], element.bounds[3]],
                })
                break
              }
              case 'image-fit': {
                if (element.kind !== 'image') break
                commands.push({ type: 'setImageFit', targetId: element.id, fit: input.fit })
                break
              }
              case 'image-crop': {
                if (element.kind !== 'image') break
                commands.push({ type: 'setImageCrop', targetId: element.id, crop: input.crop })
                break
              }
              case 'line-arrow': {
                if (element.kind !== 'line') break
                commands.push({
                  type: 'setLineArrow',
                  targetId: element.id,
                  arrow: input.preset === 'none' ? null : input.preset === 'end' ? [null, 'arrow'] : ['arrow', 'arrow'],
                })
                break
              }
            }
          }
          if (commands.length === 0) return { ok: false, error: 'No matching elements' }
          const result = bridge.dispatch(commands)
          if (!result.ok) return { ok: false, error: result.error.message }
          pushSelection()
          return { ok: true, applied: commands.length }
        }
        product = createProductSession({ sessionId: wsId, revisionId: payload.revisionId,
          snapshot: () => kernel.snapshot(), assets: () => Object.fromEntries(assetRegistry),
          setReadonly: (value) => bridge.setReadonly(value), commitPending, setDirty: (dirty) => store.setDirty(dirty),
          applyCommands, pickImageFile })
        store.on('selection', pushSelection)
      }
    },
    registerAsset(key, dataUri) {
      assetRegistry.set(key, dataUri)
    },
    async save() {
      if (product) return product.save()
      const reply = await fetch(`/ws/${encodeURIComponent(wsId)}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc: kernel.snapshot(),
          assets: Object.fromEntries(assetRegistry),
        }),
      })
      const result = (await reply.json()) as { ok: boolean; error?: string }
      if (reply.ok && result.ok) {
        // 已保存指示：最小形态，标题前缀。
        document.title = `✓ ${document.title.replace(/^✓ /, '')}`
      }
      return result
    },
  }
}
