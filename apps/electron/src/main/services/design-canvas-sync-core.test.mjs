/**
 * When an already-open design editor must be torn down and re-created from the
 * store: only if it last loaded or saved a different revision than the store
 * holds. A canvas that is not open is not stale — the next attach reads the
 * store — so this is not a guess about files on disk.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { openDesignCanvasNeedsReload } from './design-canvas-sync-core.ts'

void test('an editor that already holds the store revision is left alone', () => {
  assert.equal(openDesignCanvasNeedsReload('rev-a', 'rev-a'), false)
})

void test('an editor whose loaded revision is not the store revision must reload', () => {
  assert.equal(openDesignCanvasNeedsReload('rev-a', 'rev-b'), true)
})

void test('a canvas that is not open is not reloaded — the next attach reads the store', () => {
  assert.equal(openDesignCanvasNeedsReload(undefined, 'rev-b'), false)
})

import { DesignCanvasAccess } from './design-canvas-access.ts'
import { DesignCanvasHost } from '../../../../cli/src/design/canvas-host.ts'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const canvas = (access, artworkId, content) => {
  let readonly = true
  let draft = content
  let saved = ''
  const instance = {
    artworkId,
    async setReadonly(value) {
      readonly = value
    },
    async flush(permit) {
      await access.write(artworkId, permit, async () => {
        saved = draft
      })
    },
    edit(value) {
      if (!readonly) draft = value
    },
    state: () => ({ readonly, draft, saved })
  }
  return instance
}

void test('dispatch freezes every instance and drains accepted writes before its baseline; another artwork edits', async () => {
  const access = new DesignCanvasAccess()
  const host = new DesignCanvasHost()
  const a = canvas(access, 'art-a', 'draft-a')
  const b = canvas(access, 'art-a', 'draft-b')
  const other = canvas(access, 'art-b', 'other')
  await access.register(a)
  await access.register(b)
  await access.register(other)
  assert.equal(a.state().readonly, true)
  await access.update([])
  const saveStarted = deferred(),
    finishSave = deferred()
  const saving = access.write('art-a', undefined, async () => {
    saveStarted.resolve()
    await finishSave.promise
  })
  await saveStarted.promise
  const start = host.prepare('session-a', 'art-a', 'turn-a', new AbortController().signal)
  let started = false
  void start.then(() => {
    started = true
  })
  const freezeObserved = deferred()
  const setReadonly = b.setReadonly
  b.setReadonly = async (value) => {
    await setReadonly(value)
    if (value) freezeObserved.resolve()
  }
  const preparing = access.update(host.exchange([]))
  await freezeObserved.promise
  a.edit('lost?')
  b.edit('lost?')
  other.edit('independent')
  assert.equal(started, false)
  assert.equal(a.state().draft, 'draft-a')
  assert.equal(b.state().draft, 'draft-b')
  assert.equal(other.state().draft, 'independent')
  await assert.rejects(
    access.write('art-a', undefined, async () => {}),
    /read-only/
  )
  finishSave.resolve()
  await saving
  const reports = await preparing
  assert.equal(started, false)
  host.exchange(reports)
  await start
  assert.equal(a.state().saved, 'draft-a')
  assert.equal(b.state().saved, 'draft-b')
  await access.update(host.exchange([]))
  assert.equal(a.state().readonly, true)
  // Permission wait/cancel request/closing all surfaces are not ownership release.
  access.unregister(a)
  access.unregister(b)
  await access.disconnected()
  const reopened = canvas(access, 'art-a', 'reopened')
  await access.register(reopened)
  assert.equal(reopened.state().readonly, true)
  await access.update(host.exchange([]))
  assert.equal(reopened.state().readonly, true)
  host.release('session-a', 'turn-a')
  const refreshStarted = deferred(),
    refreshed = deferred()
  const ending = access.update(host.exchange([]), async () => {
    refreshStarted.resolve()
    await refreshed.promise
  })
  await refreshStarted.promise
  assert.equal(reopened.state().readonly, true)
  refreshed.resolve()
  await ending
  assert.equal(reopened.state().readonly, false)
})

void test('save failure keeps every draft and does not start; cancellation and late reports cannot release a successor', async () => {
  const access = new DesignCanvasAccess(),
    host = new DesignCanvasHost()
  const a = canvas(access, 'art', 'unsaved')
  a.flush = async () => {
    throw Error('disk unavailable')
  }
  await access.register(a)
  await access.update([])
  const first = host.prepare('session', 'art', 'first', new AbortController().signal)
  const rejected = assert.rejects(first, /disk unavailable/)
  host.exchange(await access.update(host.exchange([])))
  await rejected
  assert.equal(a.state().draft, 'unsaved')
  assert.equal(a.state().readonly, true)
  host.release('session', 'first')
  await access.update(host.exchange([]))
  assert.equal(a.state().readonly, false)
  const cancel = new AbortController()
  const second = host.prepare('session', 'art', 'second', cancel.signal)
  const cancelled = assert.rejects(second, /cancelled/)
  cancel.abort()
  await cancelled
  assert.equal(host.exchange([])[0].turnId, 'second')
  host.release('session', 'second')
  const third = host.prepare('session', 'art', 'third', new AbortController().signal)
  host.release('session', 'first')
  host.exchange([{ artworkId: 'art', turnId: 'first', ok: true }])
  assert.deepEqual(host.exchange([]), [{ artworkId: 'art', turnId: 'third', preparing: true }])
  host.exchange([{ artworkId: 'art', turnId: 'third', ok: true }])
  await third
  // Startup failure ends through the exact owner, retaining saved input/drafts.
  host.release('session', 'third')
  await access.update(host.exchange([]))
  assert.equal(a.state().draft, 'unsaved')
  assert.equal(a.state().readonly, false)
})

void test('an exceptional dirty reload keeps the instance readonly and present until preservation succeeds', async () => {
  const access = new DesignCanvasAccess(),
    a = canvas(access, 'art', 'recover me')
  await access.register(a)
  await access.update([{ artworkId: 'art', turnId: 'turn', preparing: false }])
  await access.update([], async () => {
    throw Error('unsaved content')
  })
  assert.equal(a.state().readonly, true)
  assert.equal(a.state().draft, 'recover me')
  await access.update([], async () => {})
  assert.equal(a.state().readonly, false)
})

void test('a connected desktop with no open canvases acknowledges a background turn', async () => {
  const host = new DesignCanvasHost(),
    access = new DesignCanvasAccess()
  const prepared = host.prepare('session', 'art', 'background', new AbortController().signal)
  host.exchange(await access.update(host.exchange([])))
  await prepared
  assert.deepEqual(host.exchange([]), [
    { artworkId: 'art', turnId: 'background', preparing: false }
  ])
  host.release('session', 'background')
})

void test('a missing desktop fails preparation explicitly without guessing that no drafts exist', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const host = new DesignCanvasHost()
  const prepared = host.prepare('session', 'art', 'offline', new AbortController().signal)
  const failed = assert.rejects(prepared, /edits and input are retained/)
  context.mock.timers.tick(30_000)
  await failed
  assert.equal(host.exchange([])[0].turnId, 'offline')
  host.release('session', 'offline')
})

import { selectCanvasInstance } from './design-canvas-sync-core.ts'

void test('different dirty copies require the selected host; completing one preserves the other', () => {
  const first = { artworkId: 'art', draft: 'first unsaved document' }
  const second = { artworkId: 'art', draft: 'second different unsaved document' }
  const instances = new Map([
    ['host-a', first],
    ['host-b', second]
  ])
  assert.throws(() => selectCanvasInstance(instances, 'art'), /specific canvas/)
  assert.deepEqual(selectCanvasInstance(instances, 'art', 'host-b'), ['host-b', second])
  const selected = selectCanvasInstance(instances, 'art', 'host-b')
  // The copy receipt/explicit discard closes only the selected identity.
  instances.delete(selected[0])
  assert.deepEqual([...instances.values()], [first])
  assert.equal(first.draft, 'first unsaved document')
})

// A controlled late conversion cannot publish into a switched/reopened canvas.
const { PreviewRequests } = await import('./design-source-preview-core.ts')
void test('source preview generations reject old artwork, refresh and closed consumers', async () => {
  const requests = new PreviewRequests()
  const original = requests.begin('host', 'artwork-a')
  let resolve
  const delayed = new Promise((done) => {
    resolve = done
  })
  let displayed = 'retained valid preview'
  const completion = delayed.then(() => {
    if (requests.current(original)) displayed = 'late draft'
  })
  const latest = requests.begin('host', 'artwork-a')
  resolve()
  await completion
  assert.equal(displayed, 'retained valid preview')
  assert.equal(requests.current(latest), true)
  requests.cancel('host')
  assert.equal(requests.current(latest), false)
  const reopened = requests.begin('host', 'artwork-b')
  assert.equal(requests.current(original), false)
  assert.equal(requests.current(reopened), true)
})

const { SourceObservation } = await import('./design-source-observation.ts')
void test('source observation shares work and suppresses dirty and closed publications', async () => {
  let finish
  const inputs = []
  const outputs = []
  const observation = new SourceObservation(
    (previous) => {
      inputs.push(previous)
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    () => false
  )
  observation.consumers.set('one', async (result, current) => {
    if (current()) outputs.push(['one', result.status])
  })
  observation.consumers.set('two', async (result, current) => {
    if (current()) outputs.push(['two', result.status])
  })
  const pending = observation.refresh()
  observation.invalidate()
  finish({ status: 'refused', error: 'old' })
  await Promise.resolve()
  assert.deepEqual(outputs, [])
  finish({ status: 'refused', error: 'new' })
  await pending
  assert.deepEqual(outputs, [
    ['one', 'refused'],
    ['two', 'refused']
  ])
  const closing = observation.refresh()
  observation.close()
  finish({ status: 'refused', error: 'closed' })
  await closing
  assert.deepEqual(outputs, [
    ['one', 'refused'],
    ['two', 'refused']
  ])
})

void test('source observation fallback watches the YAML entry, not leftover PPTD', async () => {
  const seen = []
  const observation = new SourceObservation(
    async () => ({ status: 'refused', error: 'missing' }),
    (paths) => {
      seen.push(paths)
      return false
    }
  )
  observation.consumers.set('one', async () => {})
  await observation.refresh()
  assert.deepEqual(seen, [['design.yaml']])
  assert.equal(
    seen.some((paths) => paths.includes('design.pptd')),
    false
  )
  observation.close()
})

void test('source observation reconciles new dependencies before publishing and retains content identity', async () => {
  const results = []
  let dependenciesChanged = true
  const previousIdentities = []
  const result = { status: 'ok', sourceIdentity: 'bytes', doc: {}, assets: {}, width: 1, height: 1 }
  const observation = new SourceObservation(
    async (previous) => {
      previousIdentities.push(previous)
      return previous ? { status: 'unchanged', sourceIdentity: previous } : result
    },
    () => {
      const changed = dependenciesChanged
      dependenciesChanged = false
      return changed
    }
  )
  observation.consumers.set('consumer', async (value) => {
    results.push(value)
  })
  await observation.refresh()
  await observation.refresh()
  assert.deepEqual(results, [result, result])
  assert.deepEqual(previousIdentities, [undefined, undefined, 'bytes'])
  observation.close()
})

void test('explicit replacement flushes every editor and retains the lock until persistence settles', async () => {
  const access = new DesignCanvasAccess()
  const a = canvas(access, 'art', 'unsaved')
  await access.register(a)
  await access.update([])
  const entered = deferred(),
    finish = deferred()
  const importing = access.replaceAfterFlush('art', async (assertIdle) => {
    assertIdle()
    assert.equal(a.state().saved, 'unsaved')
    entered.resolve()
    await finish.promise
    return 'imported'
  })
  await entered.promise
  a.edit('must not land')
  assert.equal(a.state().draft, 'unsaved')
  await assert.rejects(
    access.replaceAfterFlush('art', async () => {}),
    /already in progress/
  )
  await assert.rejects(
    access.write('art', undefined, async () => {}),
    /read-only/
  )
  finish.resolve()
  assert.equal(await importing, 'imported')
  assert.equal(a.state().readonly, false)
})

void test('replacement rejects unknown, execution, artifact processing and a claim during flush', async () => {
  const access = new DesignCanvasAccess()
  await assert.rejects(
    access.replaceAfterFlush('art', async () => {}),
    /unknown/
  )
  for (const preparing of [true, false]) {
    await access.update([{ artworkId: 'art', turnId: 'turn', preparing }])
    await assert.rejects(
      access.replaceAfterFlush('art', async () => {}),
      /active/
    )
  }
  await access.update([])
  const entered = deferred(),
    finish = deferred()
  await access.register({
    artworkId: 'art',
    async setReadonly() {},
    async flush() {
      entered.resolve()
      await finish.promise
    }
  })
  let committed = false
  const importing = access.replaceAfterFlush('art', async () => {
    committed = true
  })
  await entered.promise
  const reports = await access.update([{ artworkId: 'art', turnId: 'racing', preparing: true }])
  assert.equal(reports[0].ok, false, 'A racing dispatch cannot start before import finishes')
  finish.resolve()
  await assert.rejects(importing, /active/)
  assert.equal(committed, false)
})

void test('flush or save failure retains draft and restores idle editing', async () => {
  const access = new DesignCanvasAccess()
  const a = canvas(access, 'art', 'keep this draft')
  await access.register(a)
  await access.update([])
  const flush = a.flush
  a.flush = async () => {
    throw Error('flush failed')
  }
  await assert.rejects(
    access.replaceAfterFlush('art', async () => {
      throw Error('unexpected save')
    }),
    /flush failed/
  )
  assert.deepEqual(a.state(), { readonly: false, draft: 'keep this draft', saved: '' })
  a.flush = flush
  await assert.rejects(
    access.replaceAfterFlush('art', async () => {
      throw Error('save failed')
    }),
    /save failed/
  )
  assert.deepEqual(a.state(), {
    readonly: false,
    draft: 'keep this draft',
    saved: 'keep this draft'
  })
})

void test('update preparation saves edits and blocks a new design turn until released', async () => {
  const access = new DesignCanvasAccess()
  let readonly = false
  let saved = ''
  await access.register({
    artworkId: 'poster',
    setReadonly: async (value) => {
      readonly = value
    },
    flush: async (permit) =>
      access.write('poster', permit, async () => {
        saved = 'latest draft'
      })
  })
  const query = async () => {
    await access.update([])
  }
  const release = await access.prepareApplicationUpdate(query)
  assert.equal(saved, 'latest draft')
  assert.equal(readonly, true)
  await assert.rejects(access.prepareForSend('poster'), /preparing an update/)
  await assert.rejects(
    access.replaceAfterFlush('poster', async () => {
      saved = 'replacement'
    }),
    /preparing an update/
  )
  assert.equal(saved, 'latest draft')
  const reports = await access.update([{ artworkId: 'another', turnId: 'next', preparing: true }])
  assert.equal(reports[0].ok, false)
  await access.update([])
  await release()
  assert.equal(readonly, false)
})

void test('an executing Agent prevents update installation without losing editor access state', async () => {
  const access = new DesignCanvasAccess()
  await assert.rejects(
    access.prepareApplicationUpdate(async () => {
      await access.update([{ artworkId: 'poster', turnId: 'running', preparing: false }])
    }),
    /Wait for Agent/
  )
  assert.equal(access.isReadonly('poster'), true)
  await access.update([])
  assert.equal(access.isReadonly('poster'), false)
})

void test('failed save releases the update gate and keeps edits retryable', async () => {
  const access = new DesignCanvasAccess()
  await access.register({
    artworkId: 'poster',
    setReadonly: async () => {},
    flush: async () => {
      throw new Error('disk full')
    }
  })
  await assert.rejects(
    access.prepareApplicationUpdate(async () => {
      await access.update([])
    }),
    /disk full/
  )
  assert.equal(access.isReadonly('poster'), false)
  await access.write('poster', undefined, async () => {})
})
