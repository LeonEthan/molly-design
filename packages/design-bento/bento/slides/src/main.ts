// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Boot sequence. Order matters: capture the pristine document BEFORE any DOM
// mutation — the captured copy is what gets re-serialized on save.

import './styles.css'
import { anim } from './anim'
import { configureApp, appConfig } from '../../kernel/src/app.ts'
import { startTheme } from '../../kernel/src/theme.ts'
import { startNetGuard } from '../../kernel/src/net.ts'
import {
  capturePristine, readEmbeddedDoc, serializeFile, serializeAuto, downloadFile,
  suggestedFileName, parseEnvelope, decryptEnvelope, setEncryptionPassword,
  registerPreview,
} from './save'
import { buildSlidePreview } from './preview'
import { APP_VERSION, checkForUpdates, buildUpdatedFile, applyUpdate } from './update'
import { i18nApi, t, applyDirection } from './i18n'
import { parseDoc, type BentoDoc, type TextElement } from './model'
import { validateDoc, type ValidateOpts } from './validate'
import { measureText, measureElement, type TextMeasureSpec } from './measure'
import { starterDoc } from './starterdeck'
import { injectFonts } from './fonts'
import { Store } from './store'
import { Editor } from './editor/editor'
import { startPresentation } from './present'
import { SyncSession } from './sync/session'
import { onlineTransport, startSharing, stopSharing } from './sync/online'
import { bootA1a2Workspace, type A1a2Session } from './a1a2/boot.ts'
import { bootFrameHost } from './a1a2/packages/editor-bento/src/boot/frame-host.ts'
import { sealExit } from './a1a2/packages/editor-bento/src/bypass-seal.ts'

// Tell the kernel who this app is — must precede any kernel module use
// (window title suffix, save-picker label, update manifest + its `app` check).
configureApp({
  appId: 'bento-slides',
  appName: 'bento/slides',
  manifestUrl: 'https://bento.page/releases/slides/manifest.json',
})

// Every save writes a static rendering of page one into the shell, so file
// managers thumbnail the deck instead of the boot splash (src/preview.ts).
// Registered before capturePristine only for tidiness — nothing serializes
// this early — but it must be registered before the first save.
registerPreview((doc) => buildSlidePreview(doc as BentoDoc))

capturePristine()

// Theme: after capturePristine, before the first paint.
//
// AFTER, because capturePristine clones the LIVE document and saves
// re-serialize that clone — so `data-theme` and `color-scheme` on <html> must
// not exist yet, or a viewer's preference would travel inside every file they
// save. Same rule applyDirection follows two lines below for dir/lang.
//
// BEFORE the paint, because applying it later renders the interface light and
// then flips it, which reads as a bug rather than a preference. Nothing here
// lays anything out — it sets two attributes on the root element.
startTheme()

// Watch the offline switch in OTHER tabs. `storage` fires only in the tabs
// that did not make the change — which is precisely the set that has an open
// socket it does not yet know to close (GHSA-5c3x-xqp6-g94r).
startNetGuard()

// Chrome direction follows the VIEWER's language (Arabic/Hebrew/… get an RTL
// interface). Deliberately AFTER capturePristine: saves re-serialize the
// pristine clone, so the dir/lang attributes never reach a saved file — the
// same viewer-scoped rule as 'bento-lang' and reduced motion. The DOCUMENT
// never mirrors; styles.css pins every slide surface back to direction: ltr.
applyDirection()

// --- boot gates: password-encrypted files, read-only player files -----------

const embedded = readEmbeddedDoc()
const envelope = embedded ? parseEnvelope(embedded) : null
// A1a-2: ?ws=<id> 由 a1a2 composition root 接管 boot（semantic kernel 为 canonical
// 权威，native 仅为投影）。无 ws 参数的打开不是 A1a-2 路径，见 editorMode 守卫。
const a1a2Ws = new URLSearchParams(location.search).get('ws')
if (a1a2Ws) {
  // A1a-2 generic frame hook: register project-side adapter renderers
  // (packages/editor-bento/src/renderers/*, copied into a1a2/packages) BEFORE any
  // render path. Idempotent; ?ws= and other boot paths share the same registry.
  bootFrameHost()
  void bootA1a2Workspace(a1a2Ws).then((session) => bootWith(session.nativeDoc as BentoDoc, session))
} else if (envelope) {
  void passwordGate()
} else {
  bootWith((embedded && parseDoc(embedded)) || starterDoc())
}

/** Encrypted file: ask for the password (looping on failure), then boot. */
async function passwordGate() {
  const gate = document.createElement('div')
  gate.className = 'ed-pwgate'
  gate.innerHTML =
    `<div class="ed-pwcard"><div class="ed-pwmark">🔒</div>` +
    `<h1>${t('This file is encrypted.')}</h1>` +
    `<p>${t('Enter password to open this deck')}</p>` +
    `<input type="password" autocomplete="current-password">` +
    `<button>${t('Unlock')}</button><div class="ed-pwerr"></div></div>`
  document.body.appendChild(gate)
  document.getElementById('bento-splash')?.remove()
  const input = gate.querySelector('input')!
  const button = gate.querySelector('button')!
  const err = gate.querySelector<HTMLElement>('.ed-pwerr')!
  const tryUnlock = async () => {
    const pass = input.value
    if (!pass) return
    button.setAttribute('disabled', '')
    const json = await decryptEnvelope(envelope!, pass)
    button.removeAttribute('disabled')
    if (json === null) {
      err.textContent = t('Wrong password — try again')
      input.select()
      return
    }
    const doc = parseDoc(json)
    if (!doc) {
      err.textContent = t('Wrong password — try again')
      return
    }
    setEncryptionPassword(pass) // saves + updates keep writing encrypted
    gate.remove()
    bootWith(doc)
  }
  button.addEventListener('click', () => void tryUnlock())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void tryUnlock()
  })
  input.focus()
}

function bootWith(doc: BentoDoc, a1a2?: A1a2Session) {
  if (doc.readonly) playerMode(doc)
  else editorMode(doc, a1a2)
}

/**
 * Read-only files are PLAYER files: they open straight into the show and
 * never expose the editor. Leaving the presentation lands on a minimal card.
 */
function playerMode(doc: BentoDoc) {
  document.title = `${doc.title} — ${appConfig().appName}`
  if (doc.fonts?.length) injectFonts(doc)
  document.getElementById('bento-splash')?.remove()
  const card = document.createElement('div')
  card.className = 'ed-player'
  card.innerHTML =
    `<div class="ed-playercard"><h1>${doc.title.replace(/</g, '&lt;')}</h1>` +
    `<p>${t('This is a presentation package — view and present only.')}</p>` +
    `<button class="ed-playgo">▶&nbsp; ${t('Present')}</button>` +
    `<button class="ed-playcopy">⤓&nbsp; ${t('Save a copy')}</button></div>`
  document.body.appendChild(card)
  const start = () => {
    card.style.display = 'none'
    startPresentation(doc, 0, () => {
      card.style.display = ''
    })
  }
  card.querySelector('.ed-playgo')!.addEventListener('click', start)
  card.querySelector('.ed-playcopy')!.addEventListener('click', () => {
    void serializeAuto(doc).then((html) => downloadFile(html, suggestedFileName(doc)))
  })
  ;(window as any).bento = { format: doc.format, doc, readonly: true }
  start()
}

function editorMode(doc: BentoDoc, a1a2?: A1a2Session) {

// A1a-2 构建只服务 ?ws= 会话：无 session 时 semantic canonical 不存在，拒绝进入编辑器。
if (!a1a2) {
  document.getElementById('bento-splash')?.remove()
  document.body.innerHTML = '<p style="padding:2rem;font:14px sans-serif">A1a-2 build: open with ?ws=&lt;workspace-id&gt;</p>'
  return
}

document.title = `${doc.title} — ${appConfig().appName}`

// Embedded fonts: register @font-face rules from the asset table so text
// elements can use bundled families in the editor, presenter and thumbnails.
if (doc.fonts?.length) injectFonts(doc)

const store = new Store(doc)
const editor = new Editor(document.getElementById('app')!, store, a1a2.bridge)
a1a2.attachStore(store, () => editor.commitPendingText())

// Live collaboration (bento-sync): same-machine tabs sync automatically over
// BroadcastChannel; the online relay transport joins via the Share UI.
// A1a-2 bypass seal (ticket #14): the adapted build never constructs a
// SyncSession — no BroadcastChannel, no collab stamp, no relay transport. The
// sealed `sync` surface below answers every collab probe with a named
// SealedExitError instead.
const adapted = a1a2 !== undefined
const session = adapted ? null : new SyncSession(store)
if (session) editor.connectSync(session)

// Opening a link ending in #present starts the show immediately (player mode).
if (location.hash === '#present') {
  editor.present(true)
}

// Dismiss the boot splash (inline in index.html so it paints before this
// bundle parses). Hold it briefly so the assemble animation reads as a
// brand moment instead of a flicker; the pristine capture ran before this,
// so saved files keep the splash for their own next boot.
{
  const splash = document.getElementById('bento-splash')
  if (splash) {
    const wait = Math.max(0, 1250 - performance.now())
    setTimeout(() => {
      splash.classList.add('done')
      setTimeout(() => splash.remove(), 550)
    }, wait)
  }
}

// Small scripting surface for tooling and automation: read/replace the
// document model and serialize the full .bento.html file.
;(window as any).bento = {
  format: doc.format,
  get doc() {
    return store.doc
  },
  serialize: () => {
    // A1a-2 bypass seal: native serialize would emit projected-store bytes
    // outside the committed canonical — always sealed in the adapted build.
    if (adapted) return sealExit('serialize-file')
    session!.stampInto(store.doc)
    return serializeFile(store.doc)
  },
  undo: () => a1a2.bridge.undo(),
  redo: () => a1a2.bridge.redo(),
  get selection() {
    return store.selection.slice()
  },
  /** A1a-2 bridge 公开面：命令 trace / 只读投影 inspect / 单调 revision */
  visual: {
    get revision() { return a1a2.bridge.revision },
    trace: () => a1a2.bridge.trace(),
    inspect: () => a1a2.bridge.inspect(),
    snapshot: () => a1a2.bridge.snapshot(),
  },
  /** A1a-2 保存：semantic canonical JSON + 资产表回写 workspace */
  save: () => a1a2.save(),
  /** A1a-2 资产登记（setAsset 前置，key = 内容 sha256 hex） */
  registerAsset: (key: string, dataUri: string) => a1a2.registerAsset(key, dataUri),
  /** animation engine, exposed for scripting/diagnostics */
  anim,
  /** i18n: t/locale/setLocale/choices — setLocale('x-pseudo') audits the sweep */
  i18n: i18nApi,
  /** live-collaboration session: actor id, connected peers, force a diff-flush */
  sync: adapted ? {
    get actor() { return sealExit('collab-session') },
    peers: () => sealExit('collab-session'),
    flush: () => sealExit('collab-session'),
    transports: () => sealExit('collab-session'),
    share: () => sealExit('collab-session'),
    unshare: () => sealExit('collab-session'),
    online: () => sealExit('collab-session'),
  } : {
    get actor() { return session!.actor },
    peers: () => session!.peers(),
    flush: () => session!.flush(),
    transports: () => session!.transportKinds,
    /** start an online session (mints doc.collab, connects the relay) */
    share: () => {
      void startSharing(session!, store)
      return store.doc.collab
    },
    unshare: () => stopSharing(session!, store),
    online: () => onlineTransport()?.status ?? 'off',
  },
  /**
   * AI/tooling round-trip: replace the whole document from a JSON string
   * (the contents of #bento-doc). Validates via parseDoc; returns false and
   * changes nothing on invalid input. Undoable in the editor.
   */
  loadDoc(json: string): boolean {
    // A1a-2 bypass seal: replacing the projected doc outside the kernel is a
    // canonical bypass (kernel canonical would silently diverge) — seal it.
    if (adapted) return sealExit('native-load-doc')
    const next = parseDoc(json)
    if (!next) return false
    store.replaceDoc(next)
    return true
  },
  /**
   * Report what the runtime would otherwise swallow: unknown keys, text that
   * overflows its box, elements off the canvas, effects that can never run,
   * broken links and asset refs, chart options charts-lite ignores. Read-only
   * — it never changes the document. Pass a doc to check one you have not
   * loaded; defaults to the open one.
   */
  validate(target?: BentoDoc, opts?: ValidateOpts) {
    return validateDoc(target ?? store.doc, opts)
  },
  /**
   * How tall does this text need to be? The format is absolute pixels, so
   * without a screen the height of a string is a guess — this answers it by
   * rendering through the real renderer.
   *
   * Pass an element id to measure one that exists, or a spec
   * ({html, w, fontSize, …}) to size text BEFORE creating the element, which
   * is the point: an agent can lay a slide out correctly the first time
   * instead of writing it, checking, and correcting.
   *
   * Returns {height, width, lines} — plus {fits, overflow} when you supply `h`.
   */
  measure(target: string | TextMeasureSpec, opts?: { doc?: BentoDoc }) {
    const doc = opts?.doc ?? store.doc
    if (typeof target !== 'string') return measureText(target, doc)
    for (const s of doc.slides) {
      const el = s.elements.find((e) => e.id === target && e.type === 'text')
      if (el) return measureElement(el as TextElement, doc)
    }
    return null
  },
  /**
   * Self-update surface (all user/tooling-initiated, never automatic):
   * check() fetches + signature-verifies the release manifest; build()
   * returns the updated file's html (this doc inside the new shell);
   * apply() downloads it. check(url) accepts an override for testing.
   */
  updates: {
    version: APP_VERSION,
    // A1a-2 bypass seal: manifest fetch + self-update serialize are
    // network/persistence exits — sealed in the adapted build.
    check: (url?: string) => adapted ? sealExit('update-network') : checkForUpdates(url),
    build: (release: any) => {
      if (adapted) return sealExit('update-network')
      session!.stampInto(store.doc)
      return buildUpdatedFile(release, store.doc)
    },
    apply: (release: any) => {
      if (adapted) return sealExit('update-network')
      session!.stampInto(store.doc)
      return applyUpdate(release, store.doc)
    },
  },
  /**
   * Flat list of every review comment thread — the entry point for tooling
   * and AI agents processing the deck ("fix everything people flagged"):
   * each item carries the slide, a typed anchor (element / point / slide),
   * author, text, replies and resolved state.
   */
  comments() {
    return store.doc.slides.flatMap((s, slideIndex) =>
      (s.comments ?? []).map((c) => ({
        slideId: s.id,
        slideIndex,
        id: c.id,
        anchor: c.elementId
          ? { type: 'element' as const, elementId: c.elementId }
          : typeof c.x === 'number'
            ? { type: 'point' as const, x: c.x, y: c.y }
            : { type: 'slide' as const },
        author: c.author,
        at: c.at,
        text: c.text,
        replies: c.replies ?? [],
        resolved: !!c.resolved,
      })),
    )
  },
}

} // editorMode
