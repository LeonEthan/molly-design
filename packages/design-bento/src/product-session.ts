import type {
  DesignSelectionSummary,
  DesignToolbarPresentation,
} from '@molly/shared/design-selection-commands';
import {
  arrowShapeIcon,
  chevronDownIcon,
  ellipseIcon,
  imageIcon,
  lineIcon,
  minusIcon,
  mousePointer2Icon,
  plusIcon,
  rectangleIcon,
  redo2Icon,
  renderUiIconSvg,
  triangleIcon,
  typeIcon,
  undo2Icon,
  type UiIconNode,
} from '@molly/shared/ui-icons';
import { createSelectionToolbar } from './selection-toolbar';

/** Product editor persistence and its fixed, revision-bound parent bridge. */
export function createProductSession(options: {
  sessionId: string;
  revisionId: string;
  snapshot(): unknown;
  assets(): Record<string, string>;
  commitPending(): void;
  setReadonly(value: boolean): void;
  setDirty(dirty: boolean): void;
  applyCommands(payload: unknown): unknown;
  pickImageFile(onAsset: (assetKey: string, dataUri: string) => void): void;
}) {
  const editorInstanceId = new URLSearchParams(location.search).get('editorInstance') ?? '';
  const embedded = window.parent !== window && /^[a-f0-9-]{36}$/.test(editorInstanceId);
  let revisionId = options.revisionId;
  let selection: unknown[] = [];
  let selectionEpoch = 0;
  let lastSelectionSummary: unknown;
  let selectedIds: string[] = [];
  const assertSelection = (expected?: number) => {
    if (expected !== undefined && expected !== selectionEpoch)
      throw Error('Selection changed; select the current elements again');
  };
  const toolbar = createSelectionToolbar({
    async request(input) {
      const response = await fetch(`/ws/${encodeURIComponent(options.sessionId)}/toolbar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return response.json();
    },
  });
  window.addEventListener('pagehide', () => toolbar.dispose(), { once: true });
  let editSeq = 0;
  let savedSeq = 0;
  let pendingText = false;
  let pendingTextNode: HTMLElement | null = null;
  let composing = false;
  let conflict = false;
  let saving: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state = 'loading';
  let ready = false;
  let error = '';
  let readonly = true;
  let readonlyMessage = '只读 / Read-only';
  let writePermit: string | undefined;
  options.setReadonly(true);
  document.body.dataset.readonly = 'true';
  const style = document.createElement('style');
  style.textContent = `
:root{color-scheme:light dark}
.ed-panel-toggle,.ed-resizer,.ed-logo,.ed-title,.ed-insert,.ed-group-right,.ed-sidebar,.ed-present-pill,.ed-phone-only,.ed-props,.ed-topbar,.c2a-surface{display:none!important}
.ed-corner-br{inset-inline-end:auto!important;left:14px!important}
.ed-zoombtn:has(.molly-zoom-icon){padding:5px 6px}
.molly-zoom-icon{display:block;width:14px;height:14px}
/* Keep Moveable's 14px targets and inverse-zoom geometry; only the painted
   handles shrink. The opaque centers stay legible over light and dark artwork. */
.ed-stage-scale .moveable-control-box{--moveable-color:#8796ab}
.ed-stage-scale .moveable-control-box .moveable-control{border:0;background:transparent}
.ed-stage-scale .moveable-control-box .moveable-control::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;box-sizing:border-box;transform:translate(-50%,-50%);border:1px solid var(--moveable-color);border-radius:50%;background:#fff;pointer-events:none}
.ed-stage-scale .moveable-control-box .moveable-n::after,.ed-stage-scale .moveable-control-box .moveable-s::after{width:14px;height:5px;border-radius:999px}
.ed-stage-scale .moveable-control-box .moveable-e::after,.ed-stage-scale .moveable-control-box .moveable-w::after{width:5px;height:14px;border-radius:999px}
.ed-stage-scale .moveable-control-box .moveable-control:hover::after{border-color:#627994;background:#edf2f7}
/* Reserve the 281px dock, the 14px edge inset and a 12px minimum gap. */
#autosave-status{position:fixed;bottom:14px;right:14px;z-index:9999;display:flex;align-items:center;gap:6px;max-width:calc(50vw - 168px);box-sizing:border-box;padding:5px 11px;background:Canvas;color:CanvasText;border-radius:9px;font:12px system-ui;box-shadow:0 4px 14px rgb(0 0 0 / .16),0 0 0 1px rgb(0 0 0 / .04);opacity:.85}
#autosave-status .message{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#autosave-status .dot{width:6px;height:6px;border-radius:50%;background:#14ae5c;flex:none}
#autosave-status[data-state="saving"] .dot,#autosave-status[data-state="pending"] .dot,#autosave-status[data-state="editing"] .dot,#autosave-status[data-state="loading"] .dot{background:#888}
#autosave-status[data-state="error"] .dot,#autosave-status[data-state="conflict"] .dot{background:#f24822}
.molly-dock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:4px;max-width:calc(100vw - 24px);box-sizing:border-box;overflow-x:auto;scrollbar-width:none;background:Canvas;color:CanvasText;border-radius:999px;padding:8px 10px;box-shadow:0 6px 20px rgb(0 0 0 / .12),0 0 0 1px rgb(0 0 0 / .04)}
.molly-dock button{width:38px;height:38px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;font:400 18px system-ui;padding:0}
.molly-dock button:hover{background:#8882}
.molly-dock button.on{background:CanvasText;color:Canvas}
.molly-dock svg{width:20px;height:20px;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
.molly-dock .sep{width:1px;height:18px;background:#8884;margin:0 4px}
.molly-dock .caret{width:12px;height:12px;margin-left:-2px}
.molly-dock button:disabled{opacity:.35;pointer-events:none}
.molly-shape-popup{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483001;display:none;flex-direction:column;background:Canvas;color:CanvasText;border-radius:16px;padding:6px;box-shadow:0 4px 14px rgb(0 0 0 / .16),0 0 0 1px rgb(0 0 0 / .04);min-width:170px;max-height:50vh;overflow:auto}
.molly-shape-popup.open{display:flex}
.molly-shape-popup button{display:flex;align-items:center;gap:9px;padding:7px 10px;border:none;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:12.5px system-ui;text-align:left}
.molly-shape-popup button:hover{background:#8882}
.molly-shape-popup svg{width:16px;height:16px;flex:none;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
/* Keep zoom and save feedback reachable when all three bottom surfaces cannot
   fit on one row. Extremely narrow docks scroll without shrinking the targets. */
/* With the dock raised, reserve 140px for zoom plus edge insets and a gap. */
@media(max-width:640px){.molly-dock{bottom:64px}.molly-shape-popup{bottom:130px}#autosave-status{max-width:calc(100vw - 180px)}}
`;
  document.head.append(style);
  const dock = document.createElement('div');
  dock.className = 'molly-dock';
  const dockSep = () => {
    const sep = document.createElement('span');
    sep.className = 'sep';
    dock.append(sep);
  };
  const dockButton = (icon: string, label: string, onClick: () => void, extraClass = '') => {
    const button = document.createElement('button');
    button.innerHTML = icon;
    button.title = label;
    button.setAttribute('aria-label', label);
    if (extraClass) button.className = extraClass;
    button.disabled = readonly && (extraClass === 'create' || extraClass === 'history');
    button.onclick = onClick;
    dock.append(button);
    return button;
  };
  const clickHidden = (selector: string) => () =>
    (document.querySelector(selector) as HTMLElement | null)?.click();
  // Insert goes through the same validated command channel as selection controls;
  // the readonly check mirrors window.molly.applyCommands (CSS also greys out).
  const addElement = (payload: Record<string, unknown>) => {
    if (readonly) return;
    options.commitPending();
    options.applyCommands({ verb: 'add-element', ...payload });
  };
  dockButton(renderUiIconSvg(mousePointer2Icon), '选择 / Select', () => {}, 'on');
  dockButton(
    renderUiIconSvg(undo2Icon),
    '撤销 / Undo (⌘Z)',
    clickHidden('.ed-group-history > button:nth-child(1)'),
    'history'
  );
  dockButton(
    renderUiIconSvg(redo2Icon),
    '重做 / Redo (⇧⌘Z)',
    clickHidden('.ed-group-history > button:nth-child(2)'),
    'history'
  );
  dockSep();
  dockButton(
    renderUiIconSvg(typeIcon),
    '文本 / Text (T)',
    () => addElement({ kind: 'text' }),
    'create'
  );
  const shapePopup = document.createElement('div');
  shapePopup.className = 'molly-shape-popup';
  // Insert menu mirrors the kernel's modeled presets; each entry carries the
  // exact add-element payload (one command = one undo batch).
  const shapeItems: Array<[readonly UiIconNode[], string, Record<string, unknown>]> = [
    [rectangleIcon, '矩形 / Rectangle', { kind: 'shape', shapeName: 'rect' }],
    [ellipseIcon, '椭圆 / Ellipse', { kind: 'shape', shapeName: 'ellipse' }],
    [triangleIcon, '三角形 / Triangle', { kind: 'shape', shapeName: 'triangle' }],
    [arrowShapeIcon, '箭头 / Arrow', { kind: 'shape', shapeName: 'arrow' }],
    [lineIcon, '直线 / Line', { kind: 'line' }],
  ];
  dockButton(
    renderUiIconSvg(rectangleIcon) +
      renderUiIconSvg(chevronDownIcon, { size: 12, className: 'caret' }),
    '形状 / Shape',
    () => {
      if (!shapePopup.classList.contains('open')) {
        shapePopup.innerHTML = '';
        for (const [nodes, label, payload] of shapeItems) {
          const item = document.createElement('button');
          item.innerHTML = `${renderUiIconSvg(nodes, { size: 16 })}<span>${label}</span>`;
          item.onclick = () => {
            addElement(payload);
            shapePopup.classList.remove('open');
          };
          shapePopup.append(item);
        }
      }
      shapePopup.classList.toggle('open');
    },
    'create'
  );
  dockButton(
    renderUiIconSvg(imageIcon),
    '图片 / Image',
    () => {
      if (readonly) return;
      options.pickImageFile((assetKey, dataUri) => {
        const probe = new Image();
        probe.onload = () =>
          addElement({
            kind: 'image',
            src: `asset:${assetKey}`,
            naturalWidth: probe.naturalWidth,
            naturalHeight: probe.naturalHeight,
          });
        probe.onerror = () => addElement({ kind: 'image', src: `asset:${assetKey}` });
        probe.src = dataUri;
      });
    },
    'create'
  );
  // The Editor mounts these buttons before attaching the product session.
  // Keep its listeners and live percentage label; replace only the two glyphs.
  const zoomButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.ed-zoombar .ed-zoombtn:not(.ed-zoomlabel)')
  );
  for (const [index, nodes] of [minusIcon, plusIcon].entries()) {
    const button = zoomButtons.at(index);
    if (!button) continue;
    button.innerHTML = renderUiIconSvg(nodes, { size: 14, className: 'molly-zoom-icon' });
    button.setAttribute('aria-label', button.title);
  }
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest('.molly-shape-popup') && !target?.closest('.molly-dock'))
      shapePopup.classList.remove('open');
  });
  document.body.append(dock, shapePopup);
  const status = document.createElement('div');
  status.id = 'autosave-status';
  status.setAttribute('role', 'status');
  const statusDot = document.createElement('span');
  statusDot.className = 'dot';
  const statusText = document.createElement('span');
  statusText.className = 'message';
  status.append(statusDot, statusText);
  document.body.appendChild(status);
  const setStatusMessage = (message: string) => {
    statusText.textContent = message;
    status.title = message;
    status.setAttribute('aria-label', message);
  };
  const dirty = () => pendingText || editSeq !== savedSeq;
  const identity = () => ({
    sessionId: options.sessionId,
    editorInstanceId,
    revisionId,
    editSeq,
    savedSeq,
  });
  const emit = (type: string, extra: Record<string, unknown> = {}) => {
    if (embedded) window.parent.postMessage({ type, ...identity(), ...extra }, location.origin);
  };
  // Electron hosts have no parent frame: report the display-only selection
  // summary through the molly-design protocol for the shell's composer selection.
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  const reportSelection = (summary: unknown) => {
    if (embedded) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      void fetch(`/ws/${encodeURIComponent(options.sessionId)}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
      }).catch(() => {});
    }, 150);
  };
  const mark = (next: string, message: string) => {
    if (conflict && next !== 'conflict') {
      next = 'conflict';
      message = error || message;
    }
    state = next;
    error = next === 'error' || next === 'conflict' || next === 'waiting' ? message : '';
    status.dataset.state = next;
    setStatusMessage(
      readonly && next !== 'error' && next !== 'conflict' ? readonlyMessage : message
    );
    options.setDirty(dirty());
    emit('editor-status', { state, dirty: dirty(), error, ready, composing });
  };
  const schedule = (delay = 500) => {
    clearTimeout(timer);
    if (!conflict && !readonly) timer = setTimeout(() => void flush(false).catch(() => {}), delay);
  };
  const changed = () => {
    if (!pendingTextNode?.isConnected || !pendingTextNode.isContentEditable) pendingText = false;
    editSeq++;
    toolbar.refresh();
    mark('pending', '修改尚未保存');
    schedule();
  };
  const saveOne = async () => {
    const submittedSeq = editSeq;
    const submittedRevision = revisionId;
    mark('saving', '正在保存…');
    try {
      const reply = await fetch(`/ws/${encodeURIComponent(options.sessionId)}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc: options.snapshot(),
          assets: options.assets(),
          baseRevisionId: submittedRevision,
          writePermit,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = (await reply.json()) as {
        ok?: boolean;
        code?: string;
        error?: string;
        revisionId?: string;
      };
      if (!reply.ok || result.ok !== true || typeof result.revisionId !== 'string') {
        conflict = reply.status === 409 && result.code !== 'JOB_RUNNING';
        mark(
          conflict ? 'conflict' : result.code === 'JOB_RUNNING' ? 'waiting' : 'error',
          result.error ?? '保存失败，请重试'
        );
        throw new Error(error);
      }
      revisionId = result.revisionId;
      savedSeq = submittedSeq;
      if (!dirty() && lastSelectionSummary) reportSelection(lastSelectionSummary);
      mark(dirty() ? 'pending' : 'saved', dirty() ? '修改尚未保存' : '已自动保存');
    } catch (cause) {
      if (!conflict && state !== 'waiting')
        mark('error', cause instanceof Error ? cause.message : '保存失败，请重试');
      if (!conflict) schedule(2000);
      throw cause;
    }
  };
  const flush = async (commitBuffered = true): Promise<void> => {
    clearTimeout(timer);
    if (composing && commitBuffered) throw new Error('请先完成输入法输入，再保存或离开画布');
    if (commitBuffered && !readonly) {
      options.commitPending();
      pendingText = false;
    }
    if (conflict) throw new Error(error || '画稿版本冲突，当前修改仍保留');
    const hasQueuedSave = () => editSeq !== savedSeq || saving !== undefined;
    while (hasQueuedSave()) {
      if (!saving)
        saving = saveOne().finally(() => {
          saving = undefined;
        });
      await saving;
      if (composing && commitBuffered) throw new Error('请先完成输入法输入');
      if (commitBuffered && !readonly) {
        options.commitPending();
        pendingText = false;
      }
    }
    mark(dirty() ? 'editing' : 'saved', dirty() ? '正在编辑…' : '已自动保存');
  };
  const setReadonly = (value: boolean, message = '只读 / Read-only') => {
    readonlyMessage = message;
    for (const button of dock.querySelectorAll<HTMLButtonElement>('button.create,button.history'))
      button.disabled = value;
    if (value) shapePopup.classList.remove('open');
    if (value === readonly) {
      if (readonly) setStatusMessage(readonlyMessage);
      return;
    }
    // Block new input before committing the already-buffered text synchronously.
    readonly = value;
    toolbar.setReadonly(value);
    try {
      if (value) {
        clearTimeout(timer);
        if (!composing) {
          options.commitPending();
          pendingText = false;
        }
      }
    } finally {
      options.setReadonly(value);
    }
    document.body.dataset.readonly = String(value);
    setStatusMessage(value ? readonlyMessage : dirty() ? '修改尚未保存' : '已自动保存');
    if (!value && dirty()) schedule();
  };
  const blockInput = (event: Event) => {
    if (!readonly) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Bento enters text/table editing on double-click, before any input event.
  for (const type of ['dblclick', 'beforeinput', 'paste', 'cut', 'drop'])
    document.addEventListener(type, blockInput, true);
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' ||
        event.key === 'Tab' ||
        event.key === ' ' ||
        ((event.metaKey || event.ctrlKey) &&
          ['c', '+', '-', '=', '0'].includes(event.key.toLowerCase()))
      )
        return;
      blockInput(event);
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if ((event.target as Element | null)?.closest('input,textarea,[contenteditable="true"]'))
        blockInput(event);
    },
    true
  );
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('online', () => {
    if (dirty()) schedule();
  });
  document.addEventListener('compositionstart', () => {
    composing = true;
    mark('editing', '输入法输入中…');
  });
  document.addEventListener('compositionend', () => {
    composing = false;
    mark(dirty() ? 'editing' : 'saved', dirty() ? '正在编辑…' : '已自动保存');
    if (dirty()) schedule();
  });
  document.addEventListener('input', (event) => {
    const editable = (event.target as Element | null)?.closest<HTMLElement>(
      '[contenteditable="true"]'
    );
    if (editable) {
      pendingTextNode = editable;
      pendingText = true;
      mark('editing', '正在编辑…');
    }
  });
  document.addEventListener(
    'blur',
    (event) => {
      if (event.target !== pendingTextNode) return;
      queueMicrotask(() => {
        if (!pendingTextNode?.isConnected || !pendingTextNode.isContentEditable) {
          pendingText = false;
          options.setDirty(dirty());
          if (!dirty() && !saving) mark('saved', '已自动保存');
        }
      });
    },
    true
  );
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (
      !embedded ||
      event.origin !== location.origin ||
      event.source !== window.parent ||
      !data ||
      data.type !== 'editor-save' ||
      data.sessionId !== options.sessionId ||
      data.editorInstanceId !== editorInstanceId ||
      typeof data.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(data.requestId) ||
      typeof data.revisionId !== 'string' ||
      data.revisionId.length > 100
    )
      return;
    void flush().then(
      () =>
        emit('editor-save-result', {
          requestId: data.requestId,
          requestedRevisionId: data.revisionId,
          ok: true,
        }),
      (cause) =>
        emit('editor-save-result', {
          requestId: data.requestId,
          requestedRevisionId: data.revisionId,
          ok: false,
          error: cause instanceof Error ? cause.message : '保存失败',
        })
    );
  });
  mark('loading', '画布载入中…');
  void document.fonts.ready.then(() => {
    ready = true;
    document.getElementById('bento-splash')?.remove();
    if (state === 'loading') mark('saved', '已自动保存');
    else mark(state, statusText.textContent ?? '');
    window.dispatchEvent(new Event('molly:ready'));
  });
  Object.assign(window, {
    molly: {
      setReadonly,
      presentToolbar(value: DesignToolbarPresentation) {
        toolbar.present(value);
      },
      selection(expected?: number) {
        assertSelection(expected);
        return selection;
      },
      state() {
        return {
          ready,
          dirty: dirty(),
          composing,
          saving: saving !== undefined,
          readonly,
          revisionId,
        };
      },
      async flush(permit: string) {
        writePermit = permit;
        try {
          await flush();
          return { ok: true };
        } catch (cause) {
          return { ok: false, error: String(cause) };
        } finally {
          writePermit = undefined;
        }
      },
      async save() {
        try {
          if (readonly) throw Error('Canvas is read-only');
          await flush();
          return { ok: true };
        } catch (cause) {
          return { ok: false, error: String(cause) };
        }
      },
      rebase(previous: string, next: string) {
        if (revisionId !== previous || saving) throw Error('Concurrent name change');
        revisionId = next;
      },
      async snapshot() {
        if (composing) throw Error('Finish composing text before copying');
        if (saving) await saving.catch(() => {});
        if (!readonly) options.commitPending();
        const value = options.snapshot();
        return {
          doc: typeof value === 'string' ? JSON.parse(value) : value,
          assets: options.assets(),
        };
      },
      applyCommands(payload: unknown, expected?: number) {
        if (readonly) return { ok: false, error: 'Canvas is read-only' };
        try {
          assertSelection(expected);
          options.commitPending();
          assertSelection(expected);
          return options.applyCommands(payload);
        } catch (cause) {
          return { ok: false, error: String(cause) };
        }
      },
    },
  });
  return {
    changed,
    async save() {
      try {
        if (readonly) throw Error('Canvas is read-only');
        await flush();
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : '保存失败' };
      }
    },
    selection(elements: unknown[], summary: unknown) {
      const nextIds = elements.flatMap((element) =>
        typeof element === 'object' &&
        element !== null &&
        'id' in element &&
        typeof element.id === 'string'
          ? [element.id]
          : []
      );
      if (JSON.stringify(nextIds) !== JSON.stringify(selectedIds)) selectionEpoch++;
      selectedIds = nextIds;
      selection = elements;
      lastSelectionSummary = summary;
      toolbar.update(summary as DesignSelectionSummary, selectedIds, selectionEpoch);
      emit('selection', { elements });
      reportSelection(summary);
    },
  };
}
