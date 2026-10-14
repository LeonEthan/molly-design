import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMachineRpcRequestSchema, type SessionId, type WorkspaceId } from '@molly/shared';
import * as shared from '@molly/shared';
import type { AgentBrowserHostReport, AgentBrowserScope } from '@molly/shared/browser-agent-rpc';
import type { PublicBrowserIpc } from '../../electron/src/main/ipc/services/public-browser-ipc';
import type { PublicBrowserService } from '../../electron/src/main/services/public-browser-service';
import { BrowserHost } from '../src/browser/browser-host';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionExecutionService } from '../src/session/session-execution-service';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const require = createRequire(import.meta.url);
const componentsRequire = createRequire(
  new URL('../../../packages/components/package.json', import.meta.url)
);
const React = componentsRequire('react') as typeof import('react');
const { createRoot } = componentsRequire('react-dom/client') as typeof import('react-dom/client');
const { JSDOM } = componentsRequire('jsdom');
const browserId = 'session-browser-synthetic';
const sessionId = 'synthetic' as SessionId;
const workspaceId = 'workspace-synthetic' as WorkspaceId;
const launchId = '11000000-0000-4000-8000-000000000001';
const scope = { sessionId, browserId, runId: 'turn-1' };
const reply = { kind: 'page' as const, url: 'https://example.com', title: 'Synthetic page' };
const silent = (): Logger => ({
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  child: () => silent(),
  close: async () => {},
});

const compiled = await build({
  stdin: {
    contents: `export { PublicBrowserService } from './services/public-browser-service'; export { PublicBrowserIpc } from './ipc/services/public-browser-ipc'`,
    resolveDir: fileURLToPath(new URL('../../electron/src/main', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  external: [
    'electron',
    'electron-ipc-decorator',
    '../utils',
    '../ipc-service-deps',
    '../../platform',
    './browser-account-source',
    './browser-account-signing',
    './browser-account-isolation',
  ],
});
const rendererCompiled = await build({
  entryPoints: [
    fileURLToPath(
      new URL(
        '../../../packages/components/src/components/sessions/session-browser-panel.tsx',
        import.meta.url
      )
    ),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    'jotai',
    'react-i18next',
    'lucide-react',
    '@molly/shared',
    '@/*',
    './public-browser-surface',
    './managed-preview-surface',
    './session-browser-resume-state',
    './managed-preview-frame-cache',
    './session-browser-toolbar',
    '../settings/browser-account-import-dialog',
  ],
});
const bridgeCompiled = await build({
  entryPoints: [
    fileURLToPath(
      new URL('../../../packages/components/src/lib/electron-ipc-client.ts', import.meta.url)
    ),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['@molly/shared/message-schemas'],
});
const bridgeModule = { exports: {} };
compileFunction(bridgeCompiled.outputFiles[0].text, ['module', 'exports', 'require'])(
  bridgeModule,
  bridgeModule.exports,
  (name: string) => (name === '@molly/shared/message-schemas' ? shared : componentsRequire(name))
);
const rendererModule = { exports: {} } as {
  exports: {
    SessionBrowserPanel: typeof import('../../../packages/components/src/components/sessions/session-browser-panel').SessionBrowserPanel;
  };
};
compileFunction(rendererCompiled.outputFiles[0].text, ['module', 'exports', 'require'])(
  rendererModule,
  rendererModule.exports,
  (name: string) => {
    if (name === '@molly/shared') return shared;
    if (name === '@/lib/electron-ipc-client') return bridgeModule.exports;
    if (name === 'react-i18next')
      return { useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) };
    if (name === 'jotai') return { useAtomValue: () => undefined };
    if (name === '@/atoms') return {};
    if (name === '@/hooks/use-session-doc') return { useSessionDoc: () => ({ doc: {} }) };
    if (name === '@/lib/electron') return { isElectronRenderer: () => true };
    if (name === '@/lib/utils')
      return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
    if (name === '@/lib/session-browser-url') return { samePreviewTargetOrigin: () => true };
    if (name === './session-browser-resume-state')
      return { readSessionBrowserResumeState() {}, rememberSessionBrowserResumeState() {} };
    if (name === './managed-preview-frame-cache') return { clearManagedPreviewFrame() {} };
    if (name === '@/ui/button')
      return {
        Button: (props: import('react').ComponentProps<'button'>) =>
          React.createElement('button', props),
      };
    if (name === './session-browser-toolbar') return { SessionBrowserToolbar: () => null };
    if (name === './public-browser-surface') return { PublicBrowserSurface: () => null };
    if (name === './managed-preview-surface') return { ManagedPreviewSurface: () => null };
    if (name === '../settings/browser-account-import-dialog')
      return { BrowserAccountImportDialog: () => null };
    return componentsRequire(name);
  }
);

function fixture() {
  let activeRun: string | undefined = scope.runId;
  let queued = Promise.withResolvers<void>();
  const handler = new MessageHandler(
    { on() {}, setRequestPermissionHandler() {} } as unknown as SessionManager,
    {
      repo: { watch: () => ({ unsubscribe() {} }), getDocMeta: async () => undefined },
    } as unknown as LoroDocumentManager,
    silent(),
    {
      token: 'synthetic-token',
      workspaceId,
      userId: 'user-synthetic',
      machineId: 'machine-synthetic',
      machineName: 'synthetic',
      cliVersion: '0.0.0',
      cloudPort: createTestCloudPort(),
    }
  );
  Object.assign(handler, {
    executionService: {
      activeTurnSessionIds: () => (activeRun ? [sessionId] : []),
      getActiveInvocationContext: () => (activeRun ? { sourceTurnId: activeRun } : undefined),
    } as unknown as SessionExecutionService,
    sessionManager: {
      getSession: () => ({ agentClient: {}, getDesignHookLaunchId: () => launchId }),
    },
    readDesignSession: async () => ({ artworkId: 'synthetic-artwork' }),
    browserHost: new BrowserHost(
      () => 0,
      (callback, duration) => {
        queued.resolve();
        return setTimeout(callback, duration);
      }
    ),
  });
  const send = (request: Record<string, unknown>) =>
    handler.handleLocalMachineRpc(
      LocalMachineRpcRequestSchema.parse({
        machineId: 'machine-synthetic',
        workspaceId,
        ...request,
      })
    );
  const mainFrame = {};
  const stateListeners = new Set<(state: unknown) => void>();
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame,
    send(_channel: string, state: unknown) {
      for (const listener of stateListeners) listener(state);
    },
  });
  const owner = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    getContentSize: () => [800, 600],
    contentView: { addChildView() {}, removeChildView() {} },
  });
  const browserSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
  };
  let deps: Record<string, unknown>;
  const module = { exports: {} } as {
    exports: {
      PublicBrowserService: typeof PublicBrowserService;
      PublicBrowserIpc: typeof PublicBrowserIpc;
    };
  };
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
    module,
    module.exports,
    (name: string) => {
      if (name === 'electron')
        return {
          app: { isPackaged: false },
          safeStorage: { isEncryptionAvailable: () => true },
          session: { fromPartition: () => browserSession },
          WebContentsView: class {
            webContents = Object.assign(new EventEmitter(), {
              session: browserSession,
              getURL: () => reply.url,
              getTitle: () => reply.title,
              navigationHistory: { canGoBack: () => false, canGoForward: () => false },
              setWindowOpenHandler() {},
              isDestroyed: () => false,
            });
            setBounds() {}
            setVisible() {}
          },
        };
      if (name === 'electron-ipc-decorator')
        return {
          IpcService: class {},
          IpcMethod: () => () => {},
          getIpcContext: () => ({ event: { sender: webContents, senderFrame: mainFrame } }),
        };
      if (name === '../utils') return { formatUnknownError: (error: Error) => error.message };
      if (name === '../ipc-service-deps') return { getIpcServiceDeps: () => deps };
      if (name === '../../platform')
        return { readLocalPlatformSnapshot: async () => ({ workspace: { workspaceId } }) };
      if (name === './browser-account-signing') return { isStableSignedMacApp: () => false };
      if (name === './browser-account-source' || name === './browser-account-isolation') return {};
      return require(name);
    }
  );
  const service = new module.exports.PublicBrowserService(
    () => owner as never,
    async () => {
      const answer = await send({ method: 'browser/pause-all', params: {} });
      if (!answer.ok || answer.result.type !== 'browser/pause-all')
        throw new Error('Unexpected pause reply');
      return answer.result.paused;
    }
  );
  let leasedScope: AgentBrowserScope | undefined;
  Object.assign(service, {
    agent: {
      activeScopes: () => (leasedScope ? [leasedScope] : []),
      revoke: () => {
        leasedScope = undefined;
      },
      hasLease: () => Boolean(leasedScope),
      execute: async (_contents: unknown, next: AgentBrowserScope) => {
        leasedScope = next;
        return reply;
      },
    },
  });
  deps = {
    publicBrowserService: service,
    getMainWindow: () => owner,
    cliService: { getLocalMachineId: async () => 'machine-synthetic', sendLocalMachineRpc: send },
  };
  const ipc = new module.exports.PublicBrowserIpc();
  service.create(browserId, { x: 0, y: 0, width: 800, height: 600 });
  const exchange = (reports: AgentBrowserHostReport[] = []) =>
    send({
      method: 'browser/host',
      params: {
        reports,
        leases: service.activeAgentScopes(),
        takeovers: service.takeoverScopes(),
        capabilities: { version: 2, driver: 'agent-browser', driverRevision: 'synthetic' },
      },
    });
  const browse = async (requestId: string) => {
    await exchange();
    queued = Promise.withResolvers<void>();
    const pending = send({
      method: 'browser/execute',
      ownerSessionId: sessionId,
      params: { launchId, requestId, command: { kind: 'snapshot' } },
    });
    await queued.promise;
    const answer = await exchange();
    if (!answer.ok || answer.result.type !== 'browser/host')
      throw new Error('Unexpected host reply');
    const work = answer.result.requests[0];
    if (!work) throw new Error('Browser request was not dispatched');
    let report: AgentBrowserHostReport;
    try {
      report = {
        requestId,
        ok: true,
        reply: await service.executeAgentCommand(work.scope, work.command),
      };
    } catch (error) {
      report = {
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await exchange([report]);
    return pending;
  };
  return {
    ipc,
    service,
    browse,
    send,
    stateListeners,
    setActiveRun: (run: string | undefined) => {
      activeRun = run;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderControls(context: ReturnType<typeof fixture>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="panel"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.ipc = {
    invoke: (channel: string, input: { browserId: string }) => {
      switch (channel) {
        case 'publicBrowser.getState':
          return Promise.resolve(context.ipc.getState(input));
        case 'publicBrowser.takeAgentControl':
          return context.ipc.takeAgentControl(input);
        case 'publicBrowser.resumeAgentControl':
          return context.ipc.resumeAgentControl(input);
        default:
          throw new Error(`Unexpected renderer channel ${channel}`);
      }
    },
    on: (_channel: string, listener: (state: unknown) => void) => {
      context.stateListeners.add(listener);
      return () => context.stateListeners.delete(listener);
    },
  };
  const panel = dom.window.document.getElementById('panel');
  const root = createRoot(panel);
  await React.act(async () =>
    root.render(
      React.createElement(rendererModule.exports.SessionBrowserPanel, {
        session: {
          id: sessionId,
          machineId: 'machine-synthetic',
          userId: 'user-synthetic',
          createdAt: '2026-01-01T00:00:00Z',
          status: { type: 'idle' },
          cliType: 'builtin',
          agentType: 'codex',
        } as never,
      })
    )
  );
  const click = async (label: string) => {
    const button = [...panel.querySelectorAll('button')].find(
      (element) => element.textContent === label
    );
    expect(button, label).toBeDefined();
    await React.act(async () => button?.click());
  };
  return {
    panel,
    click,
    close: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
    },
  };
}

describe('browser resume across Electron IPC and daemon run completion', () => {
  it('releases access for an explicitly resumed active run', async () => {
    vi.useFakeTimers();
    const context = fixture();
    await context.browse('23000000-0000-4000-8000-000000000001');
    await context.ipc.takeAgentControl({ browserId });
    expect(await context.ipc.resumeAgentControl({ browserId })).toEqual({ ok: true });
    expect(context.service.getState(browserId)?.agentControl).toBe('human');
    expect(await context.browse('23000000-0000-4000-8000-000000000002')).toEqual({
      ok: true,
      result: { type: 'browser/execute', ok: true, reply },
    });
  });

  it('keeps human account access guarded when another invocation is active', async () => {
    vi.useFakeTimers();
    const context = fixture();
    await context.browse('24000000-0000-4000-8000-000000000001');
    await context.ipc.takeAgentControl({ browserId });
    context.setActiveRun('turn-2');
    await expect(context.ipc.resumeAgentControl({ browserId })).rejects.toThrow(
      'The active browser run has changed.'
    );
    expect(context.service.getState(browserId)?.agentControl).toBe('human-takeover');
    expect(await context.browse('24000000-0000-4000-8000-000000000002')).toEqual({
      ok: true,
      result: {
        type: 'browser/execute',
        ok: false,
        error: 'Agent browsing is paused while the user controls website accounts.',
      },
    });
  });

  it('rejects an unknown run when idle and does not clear the saved takeover', async () => {
    vi.useFakeTimers();
    const context = fixture();
    await context.browse('25000000-0000-4000-8000-000000000001');
    await context.ipc.takeAgentControl({ browserId });
    context.setActiveRun(undefined);
    expect(
      await context.send({
        method: 'browser/resume',
        ownerSessionId: sessionId,
        params: { runId: 'unknown-run' },
      })
    ).toEqual({ ok: true, result: { type: 'browser/control', ok: false } });
    expect(context.service.getState(browserId)?.agentControl).toBe('human-takeover');
    context.setActiveRun('turn-1');
    expect(await context.ipc.resumeAgentControl({ browserId })).toEqual({ ok: true });
  });

  it('releases human account access after the taken-over turn completes so the next turn can browse', async () => {
    vi.useFakeTimers();
    const context = fixture();
    expect(await context.browse('22000000-0000-4000-8000-000000000001')).toEqual({
      ok: true,
      result: { type: 'browser/execute', ok: true, reply },
    });
    const controls = await renderControls(context);
    try {
      await controls.click('Take control');
      expect(context.service.getState(browserId)?.agentControl).toBe('human-takeover');
      context.setActiveRun(undefined);
      await controls.click('Resume Agent');
      expect(context.service.getState(browserId)?.agentControl).toBe('human');
      expect(controls.panel.textContent).not.toContain('Agent page access is paused');
      context.setActiveRun('turn-2');
      expect(await context.browse('22000000-0000-4000-8000-000000000002')).toEqual({
        ok: true,
        result: { type: 'browser/execute', ok: true, reply },
      });
    } finally {
      await controls.close();
    }
  });
});
