(() => {
  const IPC_INVOKE_GROUPS = new Set([
    'design',
    'app',
    'cli',
    'image',
    'modelConnections',
    'localPlatform',
    'localProjects',
    'loro',
    'machineRpc',
    'notifications',
    'publicBrowser',
    'sessionControl',
    'updater',
  ]);
  const IPC_INVOKE_PATTERN = /^([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)$/u;
  const IPC_PUSH_CHANNELS = new Set([
    'design.state',
    'design.thumbnail',
    'design.preview',
    'design.selection',
    'design.selectionAction',
    'design.compare',
    'loro.event',
    'loro.status',
    'cli.output',
    'cli.state',
    'updater.state',
    'publicBrowser.state',
    'sessionControl.response',
    'app.deepLink',
    'app.menuAction',
    'app.fullscreen',
    'app.windowForeground',
    'app.nativeTheme',
    'app.globalShortcut',
    'app.sessionCompletionClick',
  ]);
  const IPC_SEND_CHANNELS = new Set(['loro.send', 'loro.subscribe', 'cli.subscribe']);

  const isInvokeChannel = (channel) => {
    const m = IPC_INVOKE_PATTERN.exec(String(channel ?? ''));
    return Boolean(m && IPC_INVOKE_GROUPS.has(m[1]));
  };

  const listeners = new Map();
  const pendingDeepLinks = [];
  let windowForeground = null;

  const dispatchPush = (envelope) => {
    if (!envelope || typeof envelope.channel !== 'string') return;
    const { channel, payload } = envelope;
    if (!IPC_PUSH_CHANNELS.has(channel)) return;
    if (channel === 'app.deepLink') {
      const set = listeners.get(channel);
      if (!set || set.size === 0) {
        pendingDeepLinks.push(payload);
        return;
      }
    }
    if (channel === 'app.windowForeground' && typeof payload === 'boolean') {
      windowForeground = payload;
    }
    const set = listeners.get(channel);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[molly-mygo-preload] push listener error:', err);
      }
    }
  };

  if (window.mygo && typeof window.mygo.on === 'function') {
    window.mygo.on('molly:push', dispatchPush);
  }

  let docGen =
    typeof window.__MOLLY_DOC_GEN__ === 'number' ? window.__MOLLY_DOC_GEN__ : 1;
  let docGenReady = Promise.resolve(docGen);
  if (window.mygo && typeof window.mygo.call === 'function') {
    docGenReady = window.mygo
      .call('MollyBridge.SyncDocGen')
      .then((synced) => {
        if (typeof synced === 'number' && Number.isFinite(synced) && synced > 0) {
          docGen = synced;
        }
        return docGen;
      })
      .catch(() => docGen);
  }

  let sendQueue = docGenReady;

  const ipcBridge = Object.freeze({
    invoke: async (channel, ...args) => {
      if (!isInvokeChannel(channel)) {
        throw new Error(`Blocked IPC invoke: ${channel}`);
      }
      if (!window.mygo || typeof window.mygo.call !== 'function') {
        throw new Error('MyGo bridge unavailable');
      }
      const currentGen = await docGenReady;
      if (channel === 'image.copyToClipboard' || channel === 'image.saveAs' || channel === 'image.saveFile') {
        const key = channel === 'image.copyToClipboard' ? 'pngBytes' : 'bytes';
        const bytes = args[0]?.[key];
        if (bytes instanceof ArrayBuffer && bytes.byteLength <= 64 * 1024 * 1024) {
          const view = new Uint8Array(bytes);
          const chunks = [];
          for (let offset = 0; offset < view.length; offset += 24576) {
            chunks.push(btoa(String.fromCharCode(...view.subarray(offset, offset + 24576))));
          }
          args[0] = { ...args[0], [key]: chunks.join('') };
        }
      }
      return await window.mygo.call('MollyBridge.Invoke', currentGen, channel, args);
    },
    on: (channel, listener) => {
      if (!IPC_PUSH_CHANNELS.has(channel)) {
        throw new Error(`Blocked IPC on: ${channel}`);
      }
      if (typeof listener !== 'function') {
        throw new Error('IPC listener must be a function');
      }
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(listener);
      if (channel === 'app.deepLink') {
        while (pendingDeepLinks.length > 0) {
          const item = pendingDeepLinks.shift();
          if (item !== undefined) listener(item);
        }
      } else if (channel === 'app.windowForeground' && windowForeground !== null) {
        listener(windowForeground);
      }
      return () => {
        set.delete(listener);
      };
    },
    send: (channel, payload) => {
      if (!IPC_SEND_CHANNELS.has(channel)) {
        throw new Error(`Blocked IPC send: ${channel}`);
      }
      if (!window.mygo || typeof window.mygo.call !== 'function') {
        return;
      }
      sendQueue = sendQueue
        .catch(() => docGen)
        .then(async () => {
          const currentGen = await docGenReady;
          await window.mygo.call('MollyBridge.Send', currentGen, channel, payload ?? null);
        })
        .catch(() => {});
    },
  });

  const platformInfo = window.__MOLLY_PLATFORM_BOOTSTRAP__ || {
    os: 'darwin',
    homeDir: '',
    machineName: 'localhost',
    preferredSystemLanguages: ['en-US'],
  };

  Object.defineProperty(window, '__MOLLY_ELECTRON__', { value: true, configurable: false });
  Object.defineProperty(window, '__MOLLY_MYGO__', { value: true, configurable: false });
  Object.defineProperty(window, '__MOLLY_PLATFORM__', {
    value: Object.freeze(platformInfo),
    configurable: false,
  });
  Object.defineProperty(window, 'ipc', { value: ipcBridge, configurable: false });
})();
