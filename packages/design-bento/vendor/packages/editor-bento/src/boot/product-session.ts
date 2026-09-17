/** Product editor persistence and its fixed, revision-bound parent bridge. */
export function createProductSession(options: {
  sessionId: string;
  revisionId: string;
  snapshot(): unknown;
  assets(): Record<string, string>;
  commitPending(): void;
  setDirty(dirty: boolean): void;
}) {
  const editorInstanceId = new URLSearchParams(location.search).get('editorInstance') ?? '';
  const embedded = window.parent !== window && /^[a-f0-9-]{36}$/.test(editorInstanceId);
  let revisionId = options.revisionId;
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
  const status = document.createElement('div');
  status.id = 'autosave-status';
  status.setAttribute('role', 'status');
  status.style.cssText = 'position:fixed;bottom:10px;right:16px;z-index:9999;padding:5px 10px;background:Canvas;color:CanvasText;border:1px solid #8886;border-radius:6px;font:12px system-ui';
  document.body.appendChild(status);
  const dirty = () => pendingText || editSeq !== savedSeq;
  const identity = () => ({ sessionId: options.sessionId, editorInstanceId, revisionId, editSeq, savedSeq });
  const emit = (type: string, extra: Record<string, unknown> = {}) => {
    if (embedded) window.parent.postMessage({ type, ...identity(), ...extra }, location.origin);
  };
  const mark = (next: string, message: string) => {
    if (conflict && next !== 'conflict') { next = 'conflict'; message = error || message; }
    state = next;
    error = next === 'error' || next === 'conflict' || next === 'waiting' ? message : '';
    status.dataset.state = next;
    status.textContent = message;
    options.setDirty(dirty());
    emit('editor-status', { state, dirty: dirty(), error, ready, composing });
  };
  const schedule = (delay = 500) => {
    clearTimeout(timer);
    if (!conflict) timer = setTimeout(() => void flush(false).catch(() => {}), delay);
  };
  const changed = () => {
    if (!pendingTextNode?.isConnected || !pendingTextNode.isContentEditable) pendingText = false;
    editSeq++;
    mark('pending', '修改尚未保存');
    schedule();
  };
  const saveOne = async () => {
    const submittedSeq = editSeq;
    const submittedRevision = revisionId;
    mark('saving', '正在保存…');
    try {
      const reply = await fetch(`/ws/${encodeURIComponent(options.sessionId)}/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doc: options.snapshot(), assets: options.assets(), baseRevisionId: submittedRevision }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await reply.json() as { ok?: boolean; code?: string; error?: string; revisionId?: string };
      if (!reply.ok || result.ok !== true || typeof result.revisionId !== 'string') {
        conflict = reply.status === 409 && result.code !== 'JOB_RUNNING';
        mark(conflict ? 'conflict' : result.code === 'JOB_RUNNING' ? 'waiting' : 'error',
          result.error ?? '保存失败，请重试');
        throw new Error(error);
      }
      revisionId = result.revisionId;
      savedSeq = submittedSeq;
      mark(dirty() ? 'pending' : 'saved', dirty() ? '修改尚未保存' : '已自动保存');
    } catch (cause) {
      if (!conflict && state !== 'waiting') mark('error', cause instanceof Error ? cause.message : '保存失败，请重试');
      if (!conflict) schedule(2000);
      throw cause;
    }
  };
  const flush = async (commitBuffered = true): Promise<void> => {
    clearTimeout(timer);
    if (composing && commitBuffered) throw new Error('请先完成输入法输入，再保存或离开画布');
    if (commitBuffered) { options.commitPending(); pendingText = false; }
    if (conflict) throw new Error(error || '画稿版本冲突，当前修改仍保留');
    while (editSeq !== savedSeq || saving) {
      if (!saving) saving = saveOne().finally(() => { saving = undefined; });
      await saving;
      if (composing && commitBuffered) throw new Error('请先完成输入法输入');
      if (commitBuffered) { options.commitPending(); pendingText = false; }
    }
    mark(dirty() ? 'editing' : 'saved', dirty() ? '正在编辑…' : '已自动保存');
  };
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('online', () => { if (dirty()) schedule(); });
  document.addEventListener('compositionstart', () => { composing = true; mark('editing', '输入法输入中…'); });
  document.addEventListener('compositionend', () => {
    composing = false;
    mark(dirty() ? 'editing' : 'saved', dirty() ? '正在编辑…' : '已自动保存');
    if (dirty()) schedule();
  });
  document.addEventListener('input', (event) => {
    const editable = (event.target as Element | null)?.closest<HTMLElement>('[contenteditable="true"]');
    if (editable) {
      pendingTextNode = editable;
      pendingText = true;
      mark('editing', '正在编辑…');
    }
  });
  document.addEventListener('blur', (event) => {
    if (event.target !== pendingTextNode) return;
    queueMicrotask(() => {
      if (!pendingTextNode?.isConnected || !pendingTextNode.isContentEditable) {
        pendingText = false;
        options.setDirty(dirty());
        if (!dirty() && !saving) mark('saved', '已自动保存');
      }
    });
  }, true);
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!embedded || event.origin !== location.origin || event.source !== window.parent ||
      !data || data.type !== 'editor-save' || data.sessionId !== options.sessionId || data.editorInstanceId !== editorInstanceId ||
      typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.requestId) ||
      typeof data.revisionId !== 'string' || data.revisionId.length > 100) return;
    void flush().then(() => emit('editor-save-result', { requestId: data.requestId, requestedRevisionId: data.revisionId, ok: true }),
      (cause) => emit('editor-save-result', { requestId: data.requestId, requestedRevisionId: data.revisionId, ok: false,
        error: cause instanceof Error ? cause.message : '保存失败' }));
  });
  mark('loading', '画布载入中…');
  void document.fonts.ready.then(() => {
    ready = true;
    document.getElementById('bento-splash')?.remove();
    if (state === 'loading') mark('saved', '已自动保存');
    else mark(state, status.textContent ?? '');
  });
  return {
    changed,
    async save() {
      try { await flush(); return { ok: true }; }
      catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : '保存失败' }; }
    },
    selection(elements: unknown[]) { emit('selection', { elements }); },
  };
}
