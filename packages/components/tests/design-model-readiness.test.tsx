// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConnection, ProtectedImageConnection } from '@molly/shared/embedded-harness';

const fakes = vi.hoisted(() => ({
  connections: [] as unknown[],
  imageConnection: null as unknown,
  failRead: false,
}));

vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    modelConnections: {
      getSnapshot: async () => {
        if (fakes.failRead) throw new Error('vault unavailable');
        return { connections: fakes.connections };
      },
      getImageSnapshot: async () => {
        if (fakes.failRead) throw new Error('vault unavailable');
        return { connection: fakes.imageConnection };
      },
    },
  }),
}));

import {
  getMissingDesignModelClasses,
  getReadyModelConnections,
  isImageConnectionReady,
  isModelConnectionReady,
  readMissingDesignModelClasses,
} from '../src/lib/design-model-readiness';
import { DesignModelReadinessReminder } from '../src/components/chat/design-model-reminder';
import { initI18n } from '../src/i18n';

const connection: ModelConnection = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  providerPresetId: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  credentialRef: 'synthetic-reference',
};

const imageConnection: ProtectedImageConnection = {
  id: '00000000-0000-4000-8000-000000000009',
  revision: 1,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  model: 'synthetic-image-model',
  hasApiKey: true,
  legacyHistoryMayContainKey: false,
};

describe('design model readiness predicates', () => {
  it('requires an enabled language connection without a configuration issue', () => {
    expect(isModelConnectionReady(connection)).toBe(true);
    expect(isModelConnectionReady({ ...connection, enabled: false })).toBe(false);
    expect(
      isModelConnectionReady({
        ...connection,
        providerPresetId: 'moonshot',
        baseUrl: 'https://api.kimi.com/coding/v1',
      })
    ).toBe(false);
    expect(getReadyModelConnections([connection, { ...connection, enabled: false }])).toEqual([
      connection,
    ]);
  });

  it('excludes an enabled OAuth connection whose refresh was denied', () => {
    const signedIn: ModelConnection = {
      ...connection,
      providerPresetId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      authType: 'openai_oauth',
      oauth: { email: 'synthetic@example.com' },
    };
    const denied: ModelConnection = { ...signedIn, oauth: { ...signedIn.oauth, denied: true } };
    expect(isModelConnectionReady(signedIn)).toBe(true);
    expect(isModelConnectionReady({ ...signedIn, oauth: { denied: false } })).toBe(true);
    expect(isModelConnectionReady(denied)).toBe(false);
    expect(getReadyModelConnections([denied, signedIn])).toEqual([signedIn]);
    expect(getMissingDesignModelClasses({ connections: [denied], imageConnection })).toEqual([
      'language',
    ]);
  });

  it('requires an enabled image connection with a key', () => {
    expect(isImageConnectionReady(imageConnection)).toBe(true);
    expect(isImageConnectionReady({ ...imageConnection, enabled: false })).toBe(false);
    expect(isImageConnectionReady({ ...imageConnection, hasApiKey: false })).toBe(false);
    expect(isImageConnectionReady(null)).toBe(false);
    expect(isImageConnectionReady(undefined)).toBe(false);
  });

  it('names each missing class and treats unread state as missing', () => {
    expect(getMissingDesignModelClasses({ connections: [connection], imageConnection })).toEqual(
      []
    );
    expect(
      getMissingDesignModelClasses({ connections: [connection], imageConnection: null })
    ).toEqual(['image']);
    expect(getMissingDesignModelClasses({ connections: [], imageConnection })).toEqual([
      'language',
    ]);
    expect(
      getMissingDesignModelClasses({ connections: undefined, imageConnection: undefined })
    ).toEqual(['language', 'image']);
  });
});

describe('readMissingDesignModelClasses', () => {
  beforeEach(() => {
    fakes.connections = [connection];
    fakes.imageConnection = imageConnection;
    fakes.failRead = false;
  });

  it('reports nothing when both model classes are connected', async () => {
    await expect(readMissingDesignModelClasses()).resolves.toEqual([]);
  });

  it('reports the missing classes from the saved snapshots', async () => {
    fakes.connections = [{ ...connection, enabled: false }];
    fakes.imageConnection = null;
    await expect(readMissingDesignModelClasses()).resolves.toEqual(['language', 'image']);
  });

  it('reports unreadable readiness instead of ready when the snapshots cannot be read', async () => {
    fakes.failRead = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(readMissingDesignModelClasses()).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to read design model readiness',
      expect.any(Error)
    );
  });
});

describe('DesignModelReadinessReminder', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it.each([
    [['language'], 'Connect a language model to start designing.'],
    [['image'], 'Connect an image model to start designing.'],
    [['language', 'image'], 'Connect a language model and an image model to start designing.'],
    [null, 'Couldn’t check your model connections. Check them in Settings, then send again.'],
  ] as const)('names the missing class(es): %s', async (missing, message) => {
    let opened = 0;
    await act(async () =>
      root?.render(
        <DesignModelReadinessReminder
          missing={missing}
          onOpenSettings={() => {
            opened += 1;
          }}
        />
      )
    );
    expect(container.textContent).toContain(message);
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Go to Agent Settings');
    await act(async () => button?.click());
    expect(opened).toBe(1);
  });
});
