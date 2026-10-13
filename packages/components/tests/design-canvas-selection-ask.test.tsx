// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignElementReference } from '@molly/shared/design-element-reference';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  cleared: [] as unknown[][],
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { location: { href: '/', state: {} }, replace() {} } }),
  useRouterState: ({ select }: { select: (state: { location: { state: object } }) => unknown }) =>
    select({ location: { state: {} } }),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/local/sessions/design-session' }),
  useNavigate: () => async () => {},
  useBlocker: () => {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return {
    ...(await import('../src/atoms/layout-state')),
    ...(await import('../src/atoms/sidebar-state')),
    userAtom: atom(null),
    getAllAgentConfigAtom: atom([]),
    currentWorkspaceIdAtom: atom('workspace'),
    WORKSPACE_FOCUS_SCOPES: { content: 'content' },
  };
});

vi.mock('../src/atoms/runtime', async () => ({
  activeWorkspaceRuntimeAtom: (await import('jotai')).atom(null),
}));

vi.mock('../src/atoms/local-probe', async () => ({
  localProbeResultAtom: (await import('jotai')).atom({ machineId: 'machine' }),
}));

vi.mock('../src/hooks/use-session-doc', () => ({
  useSessionDoc: () => ({ history: null, synced: false }),
}));

vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: (channel: string, handler: (event: unknown) => void) => {
    ipc.handlers.set(channel, handler);
    return () => ipc.handlers.delete(channel);
  },
  getIpcServices: () => ({
    design: {
      attach: async () => {},
      hide: async () => {},
      cover: async () => null,
      presentToolbar: async () => {},
      highlight: async () => {},
      settleNotes: async (...args: unknown[]) => {
        ipc.cleared.push(args);
        return true;
      },
      hidePreview: async () => {},
      closePreview: async () => {},
      selectionSummary: async () => null,
      versions: async () => [],
      state: async () => ({ readonly: false, changed: false }),
    },
  }),
}));

import { DesignCanvas } from '../src/components/sessions/design-canvas';

const SESSION_ID = 'design-session';
const reference: DesignElementReference = {
  artworkId: SESSION_ID,
  baselineRevisionId: 'a'.repeat(64),
  elementIds: ['headline'],
};
let root: Root | undefined;
let container: HTMLDivElement;

async function mount(props: Partial<React.ComponentProps<typeof DesignCanvas>>) {
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Provider store={createStore()}>
        <DesignCanvas
          sessionId={SESSION_ID}
          active
          workspaceSlug="local"
          name="Synthetic"
          {...props}
        />
      </Provider>
    );
  });
}

async function emit(event: object) {
  await act(async () => {
    ipc.handlers.get('design.selectionAction')?.({ hostId: SESSION_ID, reference, ...event });
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  ipc.handlers.clear();
  ipc.cleared.length = 0;
  vi.unstubAllGlobals();
});

describe('inline ask from the canvas selection', () => {
  it('sends the prompt with its captured reference as a turn', async () => {
    const sent: [DesignElementReference, string][] = [];
    const referenced: unknown[] = [];
    await mount({
      onSendSelection: async (target, prompt) => {
        sent.push([target, prompt]);
      },
      onReferenceSelection: (...args) => referenced.push(args),
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: true });
    expect(sent).toEqual([[reference, 'Warmer headline']]);
    expect(referenced).toEqual([]);
  });

  it('only fills the composer draft when asked to add to chat', async () => {
    const sent: unknown[] = [];
    const referenced: unknown[] = [];
    await mount({
      onSendSelection: async (...args) => {
        sent.push(args);
      },
      onReferenceSelection: (...args) => referenced.push(args),
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: false });
    expect(sent).toEqual([]);
    expect(referenced).toEqual([[reference, 'Warmer headline', undefined]]);
  });

  it('sends a preset as its full instruction followed by the typed detail', async () => {
    const sent: unknown[] = [];
    await mount({
      onSendSelection: async (...args) => {
        sent.push(args);
      },
      onReferenceSelection: () => {},
    });
    await emit({ action: 'ask', prompt: '', send: true, preset: 'remove-background' });
    await emit({ action: 'ask', prompt: 'a red umbrella', send: true, preset: 'replace-object' });
    expect(sent).toEqual([
      [
        reference,
        "Remove the background of the selected image: edit it into a transparent PNG that keeps only the subject, then replace only that image's asset. Preserve the rest of the artwork.",
        undefined,
      ],
      [
        reference,
        "In the selected image, replace the object described below, matching the existing lighting and perspective. Use its current image as the source and replace only that image's asset. Preserve the rest of the artwork. Replace:\na red umbrella",
        undefined,
      ],
    ]);
  });

  it('shows a send failure on the canvas', async () => {
    await mount({
      onSendSelection: async () => {
        throw Error('Open this artwork’s conversation before referencing elements');
      },
      onReferenceSelection: () => {},
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: true });
    expect(container.textContent).toContain(
      'Open this artwork’s conversation before referencing elements'
    );
  });

  it('ignores asks for another artwork', async () => {
    const sent: unknown[] = [];
    await mount({
      onSendSelection: async (...args) => {
        sent.push(args);
      },
      onReferenceSelection: () => {},
    });
    await act(async () => {
      ipc.handlers.get('design.selectionAction')?.({
        hostId: SESSION_ID,
        reference: { ...reference, artworkId: 'other-artwork' },
        action: 'ask',
        prompt: 'Warmer headline',
        send: true,
      });
    });
    expect(sent).toEqual([]);
  });
});

describe('marked images from the canvas', () => {
  const image = { mimeType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };

  it('sends the marked copy as an image attachment with the marks instruction', async () => {
    const sent: [DesignElementReference, string, File | undefined][] = [];
    await mount({
      onSendSelection: async (target, prompt, file) => {
        sent.push([target, prompt, file]);
      },
      onReferenceSelection: () => {},
    });
    await emit({ action: 'marks', prompt: 'Make it gold', send: true, count: 2, image });
    expect(sent).toHaveLength(1);
    const [target, prompt, file] = sent[0]!;
    expect(target).toEqual(reference);
    expect(prompt).toMatch(/^The attached image is a copy of the selected image with .* marks/);
    expect(prompt.endsWith('Requested change:\nMake it gold')).toBe(true);
    expect(file?.type).toBe('image/png');
    expect(file?.size).toBe(4);
  });

  it('adds the marked copy and instruction to the draft when not sending', async () => {
    const referenced: [DesignElementReference, string | undefined, File | undefined][] = [];
    await mount({
      onSendSelection: async () => {},
      onReferenceSelection: (target, prompt, file) => referenced.push([target, prompt, file]),
    });
    await emit({ action: 'marks', prompt: 'Make it gold', send: false, count: 1, image });
    expect(referenced).toHaveLength(1);
    expect(referenced[0]![1]).toContain('Make it gold');
    expect(referenced[0]![2]?.name).toBe('marked.png');
  });
});

describe('numbered notes from the canvas', () => {
  const notes = [
    { reference, prompt: 'Warmer headline' },
    { reference: { ...reference, elementIds: ['photo'] }, prompt: 'Crop tighter' },
  ];

  it('sends every note in one turn, then clears the sent pins', async () => {
    const sent: unknown[] = [];
    await mount({
      onSendNotes: async (value) => {
        sent.push(value);
        return true;
      },
      onReferenceSelection: () => {},
    });
    await emit({ action: 'notes', notes, notesEpoch: 4 });
    expect(sent).toEqual([notes]);
    expect(ipc.cleared).toEqual([[SESSION_ID, SESSION_ID, 4, true]]);
  });

  it('keeps the pins and says so when the turn is not accepted', async () => {
    await mount({ onSendNotes: async () => false, onReferenceSelection: () => {} });
    await emit({ action: 'notes', notes, notesEpoch: 4 });
    expect(ipc.cleared).toEqual([[SESSION_ID, SESSION_ID, 4, false]]);
    expect(container.textContent).toContain('your notes are kept');
  });

  it('ignores notes that reference another artwork', async () => {
    const sent: unknown[] = [];
    await mount({
      onSendNotes: async (value) => {
        sent.push(value);
        return true;
      },
      onReferenceSelection: () => {},
    });
    await emit({
      action: 'notes',
      notes: [notes[0], { ...notes[1], reference: { ...reference, artworkId: 'other-artwork' } }],
      notesEpoch: 4,
    });
    expect(sent).toEqual([]);
    expect(ipc.cleared).toEqual([[SESSION_ID, SESSION_ID, 4, false]]);
  });
});
