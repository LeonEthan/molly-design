// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelConnectionSetting } from '../src/components/settings/model-connection-setting';
import { ImageConnectionSetting } from '../src/components/settings/image-connection-setting';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const { ipc } = vi.hoisted(() => ({ ipc: { modelConnections: {} as Record<string, unknown> } }));
vi.mock('../src/lib/electron-ipc-client', () => ({ getIpcServices: () => ipc }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['en', 'zh_CN'] as const)(
  'confirms recovery and refreshes both connection sections in %s',
  async (locale) => {
    await initI18n(locale);
    const copy = locale === 'en' ? en : zh;
    let recovered = false;
    const modelReports: unknown[] = [];
    const imageReports: unknown[] = [];
    const candidate = { digest: 'a'.repeat(64) };
    ipc.modelConnections = {
      getSnapshot: async () => {
        if (!recovered) throw new Error('credential_storage_unreadable');
        return { connections: [] };
      },
      getImageSnapshot: async () => {
        if (!recovered) throw new Error('credential_storage_unreadable');
        return { connection: null };
      },
      getModelCatalog: async () => ({ models: [] }),
      getModelMetadataSnapshot: async () => null,
      prepareStorageRecovery: async () => candidate,
      recoverUnreadableStorage: async (input: unknown) => {
        expect(input).toEqual(candidate);
        recovered = true;
        return { backupFileName: 'synthetic-backup.enc' };
      },
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: createStore() },
          createElement(
            Fragment,
            null,
            createElement(ModelConnectionSetting, {
              onConnectionsChange: (value) => modelReports.push(value),
            }),
            createElement(ImageConnectionSetting, {
              onConnectionChange: (value) => imageReports.push(value),
            })
          )
        )
      )
    );
    const resetButton = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === copy['settings.credentials.recover']
      );
    expect(host.textContent).toContain(copy['settings.credentials.unreadable']);
    await act(async () => resetButton()!.click());
    expect(recovered).toBe(false);
    expect(modelReports).toEqual([]);
    expect(imageReports).toEqual([]);
    confirm.mockImplementation((message) => {
      expect(message).toBe(copy['settings.credentials.recoveryConfirm']);
      return true;
    });
    await act(async () => resetButton()!.click());
    expect(recovered).toBe(true);
    expect(modelReports).toEqual([[]]);
    expect(imageReports).toEqual([null]);
    expect(host.textContent).not.toContain(copy['settings.credentials.unreadable']);
    expect(resetButton()).toBeUndefined();
  }
);

it('offers no reset for unavailable system storage', async () => {
  await initI18n('en');
  ipc.modelConnections = {
    getSnapshot: async () => {
      throw new Error('credential_storage_unavailable');
    },
    getModelCatalog: async () => ({ models: [] }),
    getModelMetadataSnapshot: async () => null,
  };
  await act(async () => root.render(createElement(ModelConnectionSetting)));
  expect(host.textContent).toContain(en['settings.models.loadFailed']);
  expect(host.textContent).not.toContain(en['settings.credentials.recover']);
});
