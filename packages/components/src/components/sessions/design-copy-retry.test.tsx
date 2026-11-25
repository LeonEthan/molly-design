// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useDesignCreation } from './design-canvas';

const state = vi.hoisted(() => ({
  writer: { upsertDocMeta: vi.fn() },
  design: {
    pending: async () => [],
    copy: vi.fn(),
    finishCopy: vi.fn(),
    acknowledge: vi.fn(),
  },
  navigate: vi.fn(),
}));
vi.mock('@/atoms/runtime', () => ({ activeWorkspaceRuntimeAtom: { writer: state.writer } }));
vi.mock('@/atoms/local-probe', () => ({ localProbeResultAtom: { machineId: 'machine' } }));
vi.mock('@/atoms', () => ({
  currentWorkspaceIdAtom: 'workspace',
  userAtom: { id: 'user' },
  getAllAgentConfigAtom: [{ machineId: 'machine', agentType: 'molly', cliType: 'builtin' }],
}));
vi.mock('jotai', async (original) => ({
  ...(await original<typeof import('jotai')>()),
  useAtomValue: (value: unknown) => value,
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/lib/session-draft-tabs', () => ({ writeStoredLastActiveTabState: () => {} }));
vi.mock('@/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({ design: state.design }),
  onIpcEvent: () => () => {},
}));

async function withCanvas(run: (save: () => Promise<void>) => Promise<void>) {
  let save!: () => Promise<void>;
  function Canvas() {
    const create = useDesignCreation('local');
    save = () => create('Copy', 10, 10, 'source', 'host');
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Canvas />));
    await run(save);
  } finally {
    await act(async () => root.unmount());
  }
}

const myGoMismatch = 'DESIGN_COPY_SOURCE_MISMATCH';
const electronMismatch = 'Drawing changed during copy; save the newer edits before leaving';

function copyStore(copyChecksSource = false) {
  vi.resetAllMocks();
  let source = 'original';
  const targets = new Map<string, string>();
  const attempted: string[] = [];
  state.design.copy.mockImplementation(async (_, association) => {
    const id = association.sessionId;
    attempted.push(id);
    if (!targets.has(id)) targets.set(id, source);
    if (copyChecksSource && targets.get(id) !== source) throw Error(myGoMismatch);
    return { association };
  });
  return {
    targets,
    attempted,
    edit: () => {
      source = 'edited';
    },
  };
}

it.each(['publication', 'acknowledgement'])(
  'reuses the target after transient %s failure',
  async (stage) => {
    const { attempted, targets } = copyStore();
    const operation =
      stage === 'publication' ? state.writer.upsertDocMeta : state.design.acknowledge;
    operation.mockRejectedValueOnce(Error('catalog unavailable'));
    await withCanvas(async (save) => {
      await expect(save()).rejects.toThrow('catalog unavailable');
      expect(state.design.finishCopy).not.toHaveBeenCalled();
      await save();
      const [id] = attempted;
      expect(attempted).toEqual([id, id]);
      expect([...targets]).toEqual([[id, 'original']]);
      expect(state.design.finishCopy).toHaveBeenCalledWith('source', id, 'host');
    });
  }
);

it.each([
  ['copy', myGoMismatch, true],
  ['finishCopy', myGoMismatch, true],
  ['finishCopy', electronMismatch, true],
  ['finishCopy', myGoMismatch, false],
  ['finishCopy', electronMismatch, false],
] as const)(
  'recovers from %s rejecting with %s (prior publication failure %s)',
  async (stage, message, publicationFails) => {
    const { attempted, targets, edit } = copyStore(stage === 'copy');
    if (stage === 'finishCopy') {
      state.design.finishCopy.mockImplementationOnce(async (_, id) => {
        expect(state.design.acknowledge).toHaveBeenCalledWith(id);
        edit();
        throw Error(message);
      });
    }
    await withCanvas(async (save) => {
      if (publicationFails) {
        state.writer.upsertDocMeta.mockRejectedValueOnce(Error('catalog unavailable'));
        await expect(save()).rejects.toThrow('catalog unavailable');
        edit();
      }
      await expect(save()).rejects.toThrow(message);
      await save();
      const [original] = attempted;
      const fresh = attempted.at(-1);
      expect(fresh).not.toBe(original);
      expect(attempted).toEqual(publicationFails ? [original, original, fresh] : [original, fresh]);
      expect([...targets]).toEqual([
        [original, 'original'],
        [fresh, 'edited'],
      ]);
      expect(state.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ params: { workspaceName: 'local', sessionId: fresh } })
      );
    });
  }
);
