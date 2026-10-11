import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  cpSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Each isolated canvas owns its font faces; the React shell's fonts do not cross
// WebContents boundaries. Preserve Fontsource's script ranges and use offline WOFF2.
const interCss = ['400', '700', '400-italic', '700-italic']
  .map((face) =>
    readFileSync(require.resolve(`@fontsource/inter/${face}.css`), 'utf8').replace(
      /src: url\(\.\/files\/([^)]*\.woff2)\)[^;]*;/g,
      (_, file) =>
        `src: url(data:font/woff2;base64,${readFileSync(require.resolve(`@fontsource/inter/files/${file}`)).toString('base64')}) format('woff2');`
    )
  )
  .join('\n');

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source-manifest.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, SINGLEFILE: '1' } });
for (const [file, expected] of Object.entries(manifest.files)) {
  if (hash(readFileSync(join(root, file))) !== expected) throw Error(`Source pin changed: ${file}`);
}
// Windows TEMP may use an 8.3 alias; Vite module IDs must use one canonical path.
const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), 'molly-bento-')));
const tree = join(temporary, 'bento');
try {
  // The vendored Bento tree (bento/) already carries the applied Molly patches.
  // Assemble in a temporary copy so npm's isolated closure never touches it.
  cpSync(join(root, 'bento'), tree, { recursive: true });
  const htmlFile = join(tree, 'slides/index.html');
  const entryHtml = readFileSync(htmlFile, 'utf8');
  const splashPattern = /    <!-- splash:[\s\S]*?<\/style>/;
  if (!splashPattern.test(entryHtml)) throw Error('Pinned startup splash changed');
  const wordmark = (file) =>
    `data:image/svg+xml;base64,${readFileSync(resolve(root, '../components/src/assets', file)).toString('base64')}`;
  const splash = readFileSync(join(root, 'src/splash.html'), 'utf8')
    .replaceAll('__MOLLY_WORDMARK__', wordmark('molly-wordmark.svg'))
    .replaceAll('__MOLLY_WORDMARK_DARK__', wordmark('molly-wordmark-dark.svg'));
  writeFileSync(
    htmlFile,
    entryHtml
      .replace(splashPattern, () => splash)
      .replace('<title>bento/slides</title>', '<title>Molly Design</title>')
  );
  const destination = join(tree, 'slides/src/a1a2/packages');
  cpSync(join(root, 'vendor/packages'), destination, { recursive: true });
  for (const file of Object.keys(manifest.files).filter(
    (f) => f.startsWith('vendor/packages/') && f.endsWith('.ts')
  )) {
    const relative = file.slice('vendor/packages/'.length);
    const target = join(destination, relative);
    const up = '../'.repeat(relative.split('/').length - 1);
    const source = readFileSync(target, 'utf8')
      .replaceAll('from "contracts"', `from "${up}contracts/src/index.ts"`)
      .replaceAll('from "kernel"', `from "${up}kernel/src/kernel.ts"`);
    writeFileSync(target, source);
  }
  cpSync(
    join(root, 'src/product-session.ts'),
    join(destination, 'editor-bento/src/boot/product-session.ts')
  );
  cpSync(
    join(root, 'src/selection-toolbar.ts'),
    join(destination, 'editor-bento/src/boot/selection-toolbar.ts')
  );
  cpSync(
    join(root, 'src/layers-panel.ts'),
    join(destination, 'editor-bento/src/boot/layers-panel.ts')
  );
  cpSync(
    join(root, 'src/element-highlight.ts'),
    join(destination, 'editor-bento/src/boot/element-highlight.ts')
  );
  cpSync(join(root, 'src/note-pins.ts'), join(destination, 'editor-bento/src/boot/note-pins.ts'));
  cpSync(join(root, 'src/image.ts'), join(destination, 'editor-bento/src/ui/dom/image.ts'));
  const imageFile = join(destination, 'editor-bento/src/ui/dom/image.ts');
  writeFileSync(
    imageFile,
    readFileSync(imageFile, 'utf8').replaceAll(
      'from "contracts"',
      'from "../../../../contracts/src/index.ts"'
    )
  );
  cpSync(join(root, 'src/image-sampling.ts'), join(tree, 'slides/src/image-sampling.ts'));
  const bootFile = join(tree, 'slides/src/a1a2/boot.ts');
  const boot = readFileSync(bootFile, 'utf8');
  const payloadAnchor = '  const payload = (await response.json()) as WorkspacePayload';
  if (boot.split(payloadAnchor).length !== 2)
    throw Error('Pinned image preparation boundary changed');
  let adaptedBoot = boot.replace(
    payloadAnchor,
    payloadAnchor +
      `\n  for (const source of new Set(payload.doc.elements.filter(element => element.kind === 'image').map(element => payload.assets[element.src.replace(/^asset:/, '')]))) {\n    if (source?.startsWith('data:image/')) await prepareImageSampling(source)\n  }`
  );
  // Layer and property commands reuse the kernel's setZOrder, setRotation and
  // setStyle/setText; the product session reads elements and selects by id.
  for (const [anchor, replacement] of [
    [
      "const applyField = (key: 'color' | 'fontFamily' | 'fontSize' | 'bold' | 'italic', value: string | number | boolean) => {",
      "const applyField = (key: 'color' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'letterSpacing', value: string | number | boolean) => {",
    ],
    [
      "                if (typeof input.italic === 'boolean') applyField('italic', input.italic)\n",
      `                if (typeof input.italic === 'boolean') applyField('italic', input.italic)
                if (typeof input.letterSpacing === 'number') applyField('letterSpacing', input.letterSpacing)
                if (typeof input.lineHeight === 'number') {
                  text.lineHeight = input.lineHeight
                  delete text.lineHeightPx
                  for (const paragraph of text.paragraphs ?? []) delete paragraph.lineHeight
                  changed = true
                }
`,
    ],
    [
      "              case 'line-arrow': {\n",
      `              case 'transform': {
                if (typeof input.opacity === 'number')
                  commands.push({ type: 'setStyle', targetId: element.id, patch: { opacity: input.opacity === 1 ? null : input.opacity } })
                if (typeof input.rotation === 'number' && element.kind !== 'table' && element.kind !== 'chart')
                  commands.push({ type: 'setRotation', targetId: element.id, rotation: input.rotation === 0 ? null : input.rotation })
                break
              }
              case 'line-arrow': {
`,
    ],
    [
      '          const commands: VisualCommandV4[] = []\n          for (const element of selectedElements()) {\n',
      `          if (input?.verb === 'arrange') {
            const order = doc().elements.map((element) => element.id)
            const chosen = new Set(store.selection)
            const moves: VisualCommandV4[] = []
            const move = (id: string, index: number) => {
              const from = order.indexOf(id)
              if (from === index) return
              order.splice(from, 1)
              order.splice(index, 0, id)
              moves.push({ type: 'setZOrder', targetId: id, index })
            }
            const selectedInOrder = order.filter((id) => chosen.has(id))
            if (input.to === 'front') for (const id of selectedInOrder) move(id, order.length - 1)
            if (input.to === 'back') for (const id of [...selectedInOrder].reverse()) move(id, 0)
            if (input.to === 'forward')
              for (const id of [...selectedInOrder].reverse()) {
                const at = order.indexOf(id)
                const above = order[at + 1]
                if (above !== undefined && !chosen.has(above)) move(id, at + 1)
              }
            if (input.to === 'backward')
              for (const id of selectedInOrder) {
                const at = order.indexOf(id)
                const below = order[at - 1]
                if (below !== undefined && !chosen.has(below)) move(id, at - 1)
              }
            if (selectedInOrder.length === 0) return { ok: false, error: 'No matching elements' }
            if (moves.length === 0) return { ok: true, applied: 0 }
            const result = bridge.dispatch(moves)
            if (!result.ok) return { ok: false, error: result.error.message }
            pushSelection()
            return { ok: true, applied: moves.length }
          }
          const commands: VisualCommandV4[] = []
          for (const element of selectedElements()) {
`,
    ],
    [
      '          applyCommands, pickImageFile })',
      '          applyCommands, pickImageFile, elements: () => doc().elements, select: (ids) => store.select(ids) })',
    ],
  ]) {
    if (adaptedBoot.split(anchor).length !== 2)
      throw Error('Pinned canvas command executor changed; review layer and property commands');
    adaptedBoot = adaptedBoot.replace(anchor, replacement);
  }
  writeFileSync(
    bootFile,
    `import { prepareImageSampling } from '../image-sampling.ts'\n` + adaptedBoot
  );
  const renderFile = join(tree, 'slides/src/render.ts');
  const ordinaryImage = `      const img = document.createElement('img')
      const imgSrc = assetSrc(doc, el.src)
      if (imgSrc) img.src = imgSrc
      else img.dataset.bentoOffline = '1'
      img.draggable = false
      img.style.cssText = \`width:100%;height:100%;object-fit:\${el.fit};border-radius:\${el.radius}px;display:block\`
      node.appendChild(img)`;
  const renderer = readFileSync(renderFile, 'utf8');
  if (renderer.split(ordinaryImage).length !== 2)
    throw Error('Pinned ordinary image renderer changed; review image sampling adaptation');
  writeFileSync(
    renderFile,
    `import { renderSampledImage } from './image-sampling.ts'\n` +
      renderer.replace(
        ordinaryImage,
        `      const imgSrc = assetSrc(doc, el.src)
      if (imgSrc) node.appendChild(renderSampledImage(imgSrc, el, node))
      else node.dataset.bentoOffline = '1'`
      )
  );
  const canvasFile = join(destination, 'editor-bento/src/ui/canvas.ts');
  writeFileSync(canvasFile, readFileSync(canvasFile, 'utf8').replace('16000', '4096'));
  // Adapt only the assembled copy. Canonical omitted values and pinned vendor
  // files remain untouched; rendering resolves the product's existing default.
  const defaultsFile = join(destination, 'contracts/src/static-v1.ts');
  const defaults = readFileSync(defaultsFile, 'utf8');
  if (defaults.split('fontFamily: "MiSans",').length !== 2)
    throw Error('Pinned text font default changed; review the Inter adaptation');
  writeFileSync(defaultsFile, defaults.replace('fontFamily: "MiSans",', 'fontFamily: "Inter",'));
  const interactionFile = join(tree, 'slides/src/editor/canvas.ts');
  let interactions = readFileSync(interactionFile, 'utf8');
  for (const selector of [
    '.ed-sidebar, .ed-props, .ed-topbar',
    '.ed-present-fabs, .ed-zoombar, .ed-panel-toggle, .ed-resizer',
  ]) {
    if (!interactions.includes(selector)) throw Error('Pinned canvas UI exclusion changed');
    interactions = interactions.replaceAll(selector, selector + ', [data-molly-toolbar]');
  }
  const selectionHandoff = `      this.store.select(this.expandGroups(ids))
      if (e.isDragStartEnd) {
        e.inputEvent.preventDefault()
        this.moveable.waitToChangeTarget().then(() => {
          // The promise resolves on the NEXT target change — which may be a
          // later, unrelated selection, long after this gesture ended. Firing
          // dragStart with that stale inputEvent corrupts Moveable's drag
          // state (later gestures throw on null dragInfo). Only hand the
          // gesture over if the mouse is still down: a real drag in progress.
          if (this.pointerDown) this.moveable.dragStart(e.inputEvent)
        })
      }`;
  if (interactions.split(selectionHandoff).length !== 2)
    throw Error('Pinned selection drag handoff changed');
  interactions = interactions.replace(
    selectionHandoff,
    `      this.store.select(this.expandGroups(ids))
      if (e.isDragStartEnd) {
        e.inputEvent.preventDefault()
        this.moveable.dragStart(e.inputEvent)
      }`
  );
  const targetRefresh =
    '    if (!same) this.moveable.target = targets\n    this.moveable.updateRect()';
  if (interactions.split(targetRefresh).length !== 2)
    throw Error('Pinned selection target refresh changed');
  interactions = interactions.replace(
    targetRefresh,
    '    if (!same) this.moveable.target = targets\n    else this.moveable.updateRect()'
  );
  for (const retiredGuard of [
    '  /** primary button is down — gates the deferred selectEnd dragStart (below) */\n  private pointerDown = false\n',
    '      this.pointerDown = false\n',
    "    window.addEventListener('mousedown', (ev) => { if (ev.button === 0) this.pointerDown = true }, true)\n",
    "    window.addEventListener('mouseup', (ev) => { if (ev.button === 0) this.pointerDown = false }, true)\n",
  ]) {
    if (interactions.split(retiredGuard).length !== 2)
      throw Error('Pinned deferred drag guard changed');
    interactions = interactions.replace(retiredGuard, '');
  }
  const viewportAnchor = '  setZoom(zoom: number) {';
  if (!interactions.includes(viewportAnchor)) throw Error('Pinned canvas zoom API changed');
  // Two rounded half-paddings exceed an odd-sized viewport by one pixel.
  // That changes fitScale after each restore and compounds across live frames.
  for (const dimension of ['Width', 'Height']) {
    const padding = `Math.round(this.scroller.client${dimension} / 2)`;
    if (!interactions.includes(padding)) throw Error('Pinned canvas pan padding changed');
    interactions = interactions.replaceAll(
      padding,
      `Math.floor(this.scroller.client${dimension} / 2)`
    );
  }
  interactions = interactions.replace(
    viewportAnchor,
    `
  viewport(value?: { scale: number; x: number; y: number }) {
    this.relayout()
    if (value) {
      // Changing pan padding can also add/remove a classic scrollbar. Settle
      // the resulting fit scale before restoring the document-space center.
      for (let pass = 0; pass < 3; pass++) {
        this.setZoom(value.scale / this.fitScale)
        this.relayout()
        if (Math.abs(this.scale - value.scale) < 1e-9) break
      }
      const stage = this.stage.getBoundingClientRect()
      const box = this.scroller.getBoundingClientRect()
      this.scroller.scrollLeft += stage.left + value.x * this.scale - box.left - this.scroller.clientWidth / 2
      this.scroller.scrollTop += stage.top + value.y * this.scale - box.top - this.scroller.clientHeight / 2
    }
    const stage = this.stage.getBoundingClientRect()
    const box = this.scroller.getBoundingClientRect()
    return { scale: this.scale,
      x: (box.left + this.scroller.clientWidth / 2 - stage.left) / this.scale,
      y: (box.top + this.scroller.clientHeight / 2 - stage.top) / this.scale }
  }

` + viewportAnchor
  );
  // The kernel keeps every element inside the canvas (issue #18). A refused
  // gesture must not leave the DOM showing a frame the document never took.
  const frameDispatch = '    if (commands.length > 0) this.bridge.dispatch(commands)\n';
  if (interactions.split(frameDispatch).length !== 2)
    throw Error('Pinned frame gesture commit changed');
  interactions = interactions.replace(
    frameDispatch,
    `    if (commands.length > 0 && !this.bridge.dispatch(commands).ok) {
      const { width, height } = this.store.doc.size
      const outside = frames.some((f) => f.x < 0 || f.y < 0 || f.x + f.w > width || f.y + f.h > height)
      this.render()
      this.onFrameRejected?.(outside)
    }
`
  );
  const slideNavField = '  onSlideNav: ((dir: 1 | -1) => void) | null = null\n';
  if (interactions.split(slideNavField).length !== 2)
    throw Error('Pinned canvas callback fields changed');
  interactions = interactions.replace(
    slideNavField,
    slideNavField + '  onFrameRejected: ((outside: boolean) => void) | null = null\n'
  );
  const editorFile = join(tree, 'slides/src/editor/editor.ts');
  const editor = readFileSync(editorFile, 'utf8');
  const editorAnchor = 'export class Editor {';
  if (!editor.includes(editorAnchor)) throw Error('Pinned editor API changed');
  const slideNavWiring = '    this.canvas.onSlideNav = (dir) => this.store.goToLinear(dir)\n';
  if (editor.split(slideNavWiring).length !== 2) throw Error('Pinned canvas wiring changed');
  writeFileSync(
    editorFile,
    editor
      .replace(
        editorAnchor,
        editorAnchor +
          `
  fit() { this.canvas.zoomReset(); return this.canvas.viewport() }
  viewport(value?: { scale: number; x: number; y: number }) { return this.canvas.viewport(value) }
`
      )
      .replace(
        slideNavWiring,
        slideNavWiring +
          `    this.canvas.onFrameRejected = (outside) => this.toast(outside
      ? '元素需完整保留在画布内 / Elements must stay inside the canvas'
      : '无法应用此修改 / Couldn’t apply this change')
`
      )
  );
  const mainFile = join(tree, 'slides/src/main.ts');
  const main = readFileSync(mainFile, 'utf8').replaceAll('bento-splash', 'molly-splash');
  const mainAnchor = '  format: doc.format,';
  if (!main.includes(mainAnchor)) throw Error('Pinned scripting API changed');
  writeFileSync(
    mainFile,
    main.replace(
      mainAnchor,
      mainAnchor +
        `
  fit: () => editor.fit(),
  viewport: (value?: { scale: number; x: number; y: number }) => editor.viewport(value),
`
    )
  );
  writeFileSync(interactionFile, interactions);
  const slides = join(tree, 'slides');
  // Use the checked-in npm lockfile; installation may fill an empty CI cache.
  if (process.platform === 'win32')
    run('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], slides);
  else run('npm', ['ci', '--no-audit', '--no-fund'], slides);
  // The local overlay consumes the public command types, without copying their schema.
  mkdirSync(join(slides, 'node_modules/@molly'), { recursive: true });
  symlinkSync(
    resolve(root, '../shared'),
    join(slides, 'node_modules/@molly/shared'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  run(process.execPath, [join(slides, 'node_modules/typescript/bin/tsc'), '-b'], slides);
  run(
    process.execPath,
    [join(slides, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', 'dist-single'],
    slides
  );
  const output = resolve(root, '../../apps/electron/resources/design');
  mkdirSync(output, { recursive: true });
  const html = readFileSync(join(slides, 'dist-single/index.html'), 'utf8');
  if (!html.includes('</head>')) throw Error('Built canvas has no head for font resources');
  const shell = Buffer.from(html.replace('</head>', `<style>${interCss}</style></head>`));
  writeFileSync(join(output, 'editor.html'), shell);
  cpSync(join(root, 'sample.json'), join(output, 'sample.json'));
  cpSync(resolve(root, '../../LICENSE'), join(output, 'MOLLY-LICENSE'));
  cpSync(resolve(root, '../../NOTICE'), join(output, 'MOLLY-NOTICE'));
  cpSync(join(root, 'bento/LICENSE'), join(output, 'BENTO-LICENSE'));
  cpSync(join(root, 'SPACE-MONO-LICENSE'), join(output, 'SPACE-MONO-LICENSE'));
  cpSync(join(root, 'FONTAWESOME-LICENSE'), join(output, 'FONTAWESOME-LICENSE'));
  cpSync(require.resolve('@fontsource/inter/LICENSE'), join(output, 'INTER-LICENSE'));
  writeFileSync(
    join(output, 'build.json'),
    JSON.stringify(
      {
        source: manifest.commit,
        bento: manifest.bentoCommit,
        shellSha256: hash(shell),
        defaultFont: {
          family: 'Inter',
          package: '@fontsource/inter@5.2.8',
          cssSha256: hash(interCss),
        },
        sampleSha256: hash(readFileSync(join(root, 'sample.json'))),
        node: process.version,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`Bento resources built: ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
