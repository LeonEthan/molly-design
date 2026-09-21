import './user-data-migration'
import { verifyDesign } from './services/design-verification'
import {
  prepareDesignQuit,
  prepareDesignUpdate,
  shutdownDesignWorker
} from './services/design-service'
import { startDesignCanvasHost } from './services/design-canvas-host-service'
import { startDesignRenderHost } from './services/design-render-host-service'
import { startHarnessCredentialHost } from './services/harness-credential-host'
import { verifyDesignSample } from './services/design-sample-verification'
import { registerDesignSampleScheme } from './services/design-sample-service'
import {
  registerLocalFileResourceScheme,
  installLocalFileResourceProtocol
} from './services/local-file-resource-protocol'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import dns from 'node:dns'
import { writeHeapSnapshot } from 'node:v8'
import icon from '../../resources/icon.png?asset'
import macIcon from '../../build/icon-mac.padded.png?asset'
import { acquireSingleInstanceLock, registerOpenUrlHandler } from './deep-link'
import { registerMollyProtocolClient } from './protocol-client'
import { registerIpcServices } from './ipc/register-services'
import { openMainWindow, openOrFocusMainWindow, setMainWindowProductReloadTarget } from './window'
import { getMainWindow, setAppQuitting, setWindowsTrayAvailable } from './window-state'
import { CliService } from './services/cli-service'
import { TerminalRelay } from './services/terminal-relay'
import { LoroDataPlaneRelay } from './services/loro-data-plane-relay'
import { NotificationService } from './services/notification-service'
import { AppUpdaterService } from './services/app-updater-service'
import { shouldConstructUpdaterEnabled } from './services/app-updater-sparkle-policy'
import { GlobalShortcutsService } from './services/global-shortcuts-service'
import { WindowsTrayService } from './services/windows-tray-service'
import {
  WindowBadgeService,
  bindWindowBadgeToBrowserWindows
} from './services/window-badge-service'
import { setupApplicationMenu } from './menu'
import { isRendererReloadShortcut } from './reload-shortcut'
import { IPC_PUSH_CHANNELS } from '@molly/shared/electron-ipc'
import { PublicBrowserService } from './services/public-browser-service'
import { desktopInstallationProfile, isLocalPlatform } from './platform'
import { mainPlatformKind } from './platform'
import { getLocalLoroDataPlaneSocketPath } from '@molly/shared/node/local-ipc'
import { getLocalTerminalSocketPath } from '@molly/shared/node/local-terminal'
import { getInitialDesktopPath, markOnboardingCompleted } from './onboarding-state'
import { extractDeepLinkFromArgv } from './deep-link-url'
import { shouldHideMainWindowOnAutoLaunch } from './auto-launch-policy'
import {
  getAutoLaunchInvocationStatus,
  getHideWindowOnAutoLaunchEnabled
} from './auto-launch-settings'

registerLocalFileResourceScheme()
registerDesignSampleScheme()

const MOLLY_PROTOCOL = desktopInstallationProfile.desktopProtocol
const PRODUCT_NAME = desktopInstallationProfile.desktopProductName
const DEEP_LINK_DEBUG_PREFIX = '[electron-auth-debug]'
const IS_E2E = !app.isPackaged && (process.env.MOLLY_E2E ?? process.env.LODY_E2E) === '1'

type E2EBootDiagnostic = { stage: string; error?: string }
type E2EGlobal = typeof globalThis & {
  __MOLLY_E2E_BOOT_DIAGNOSTIC__?: E2EBootDiagnostic
  __MOLLY_E2E_WRITE_HEAP_SNAPSHOT__?: (path: string) => string
}

if (IS_E2E) {
  ;(globalThis as E2EGlobal).__MOLLY_E2E_WRITE_HEAP_SNAPSHOT__ = (path) => writeHeapSnapshot(path)
}

function recordE2EBootDiagnostic(stage: string, error?: unknown): void {
  if (!IS_E2E) return
  const diagnostic: E2EBootDiagnostic = { stage }
  if (error !== undefined) {
    diagnostic.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  const e2eGlobal = globalThis as E2EGlobal
  e2eGlobal.__MOLLY_E2E_BOOT_DIAGNOSTIC__ = diagnostic
}

function logDeepLinkDebug(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.info(DEEP_LINK_DEBUG_PREFIX, message, meta)
    return
  }
  console.info(DEEP_LINK_DEBUG_PREFIX, message)
}

app.setName(PRODUCT_NAME)
try {
  dns.setDefaultResultOrder('ipv4first')
} catch (error) {
  console.warn('[Auth] Failed to set DNS result order to ipv4first', error)
}

function createGlobalShortcutsService(iconPath: string): GlobalShortcutsService {
  return new GlobalShortcutsService(
    [
      {
        id: 'app.focus',
        handler: () => {
          openOrFocusMainWindow({ icon: iconPath })
        }
      }
    ],
    {
      onTriggered: (payload) => {
        const target =
          getMainWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
        target?.webContents.send(IPC_PUSH_CHANNELS.appGlobalShortcut, payload)
      }
    }
  )
}

registerMollyProtocolClient({
  protocol: MOLLY_PROTOCOL,
  log: logDeepLinkDebug
})

const hasSingleInstanceLock = acquireSingleInstanceLock()
logDeepLinkDebug('single instance lock status evaluated', { hasSingleInstanceLock })
if (hasSingleInstanceLock) {
  registerOpenUrlHandler()
}

if (hasSingleInstanceLock) {
  recordE2EBootDiagnostic('waiting-for-app-ready')
  const appReady = app.whenReady().then(async () => {
    const p1Probe = process.argv.find((argument) => argument.startsWith('--molly-p1-verify='))
    if (p1Probe) {
      try {
        // This opt-in synthetic probe runs before the daemon is constructed.
        // Explicit known-idle fixture; production canvases still start unknown/readonly.
        const { designCanvasAccess, setDesignCanvasStateQuery } =
          await import('./services/design-service')
        setDesignCanvasStateQuery(async () => {
          await designCanvasAccess.update([])
        })
        await verifyDesign(p1Probe.slice('--molly-p1-verify='.length))
        await shutdownDesignWorker()
        app.exit(0)
      } catch (error) {
        console.error(error)
        await shutdownDesignWorker()
        app.exit(1)
      }
      return
    }
    const designProbe = process.argv.find((argument) => argument.startsWith('--molly-p0-verify='))
    if (designProbe) {
      try {
        await verifyDesignSample(designProbe.slice('--molly-p0-verify='.length))
        await shutdownDesignWorker()
        app.exit(0)
      } catch (error) {
        console.error(error)
        await shutdownDesignWorker()
        app.exit(1)
      }
      return
    }
    installLocalFileResourceProtocol()
    recordE2EBootDiagnostic('initializing-services')
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(macIcon)

    logDeepLinkDebug('app.whenReady resolved', {
      isDefaultProtocolClient: app.isDefaultProtocolClient(MOLLY_PROTOCOL),
      protocol: MOLLY_PROTOCOL
    })
    const cliService = new CliService()
    const terminalRelay = new TerminalRelay(getLocalTerminalSocketPath(mainPlatformKind))
    const loroDataPlaneRelay = new LoroDataPlaneRelay(
      getLocalLoroDataPlaneSocketPath(mainPlatformKind)
    )

    const appUpdaterService = new AppUpdaterService({
      enabled: shouldConstructUpdaterEnabled({
        localPlatform: isLocalPlatform(),
        forceEnable:
          (process.env.MOLLY_ELECTRON_ENABLE_UPDATER ??
            process.env.LODY_ELECTRON_ENABLE_UPDATER) === '1',
        platform: process.platform,
        arch: process.arch
      }),
      requireSparkle: isLocalPlatform(),
      prepareInstall: isLocalPlatform() ? prepareDesignUpdate : undefined
    })
    const notificationService = new NotificationService(() => getMainWindow())
    const windowsTrayService = new WindowsTrayService({
      iconPath: icon,
      productName: PRODUCT_NAME,
      openOrFocusMainWindow: () => openOrFocusMainWindow({ icon })
    })
    const windowBadgeService = new WindowBadgeService()
    const publicBrowserService = new PublicBrowserService(() => getMainWindow())
    bindWindowBadgeToBrowserWindows(windowBadgeService)

    electronApp.setAppUserModelId(desktopInstallationProfile.desktopAppId)
    const globalShortcutsService = createGlobalShortcutsService(icon)
    globalShortcutsService.registerAll()
    app.once('will-quit', () => globalShortcutsService.dispose())
    app.on('browser-window-created', (_, window) => {
      // Keep Electron's native Cmd/Ctrl zoom shortcuts available. The toolkit
      // blocks Minus and shifted Equal by default when zoom is not enabled.
      optimizer.watchWindowShortcuts(window, { zoom: true })
      // electron-toolkit deliberately blocks the production reload shortcut.
      // Restore the normal desktop-app behavior requested by the user while
      // leaving Cmd/Ctrl+Shift+R and DevTools handling unchanged.
      window.webContents.on('before-input-event', (event, input) => {
        if (isRendererReloadShortcut(input, process.platform)) {
          event.preventDefault()
          window.webContents.reload()
        }
      })
    })

    const completeOnboarding = (window: BrowserWindow) => {
      markOnboardingCompleted()
      setMainWindowProductReloadTarget(window)
    }
    registerIpcServices({
      cliService,
      appUpdaterService,
      notificationService,
      terminalRelay,
      publicBrowserService,
      loroDataPlaneRelay,
      windowBadgeService,
      globalShortcutsService,
      getMainWindow,
      completeOnboarding
    })

    // The design preview render host (P2.4b): the desktop polls its daemon for
    // previews to render, so `molly_render_preview` is available exactly while
    // this window is open. Started here rather than lazily because the daemon
    // treats "no poller" as "no render capability", and a preview asked for
    // before the first poll would be refused for no reason.
    const stopDesignCanvasHost = startDesignCanvasHost(cliService)
    app.once('will-quit', () => stopDesignCanvasHost())
    const stopDesignRenderHost = startDesignRenderHost(cliService)
    app.once('will-quit', () => stopDesignRenderHost())
    const stopHarnessCredentialHost = startHarnessCredentialHost(cliService)
    app.once('will-quit', () => stopHarnessCredentialHost())

    setupApplicationMenu({
      appUpdaterService,
      getMainWindow,
      openOrFocusMainWindow: () => openOrFocusMainWindow({ icon })
    })
    const initialPath = getInitialDesktopPath()
    const loginItemSettings = getAutoLaunchInvocationStatus()
    const hideWindowOnAutoLaunch = shouldHideMainWindowOnAutoLaunch({
      preferenceEnabled: getHideWindowOnAutoLaunchEnabled(),
      launchedAtLogin: loginItemSettings.launchedAtLogin,
      initialPath,
      hasInitialDeepLink: Boolean(extractDeepLinkFromArgv(process.argv))
    })
    recordE2EBootDiagnostic('opening-main-window')
    openMainWindow({ icon, initialPath, hideWindowOnAutoLaunch })
    recordE2EBootDiagnostic('main-window-opened')
    console.info('[Electron] Initial desktop surface selected', {
      initialPath,
      hideWindowOnAutoLaunch
    })
    setWindowsTrayAvailable(windowsTrayService.start())
    cliService.autoStart(getMainWindow()?.webContents ?? undefined)
    appUpdaterService.start()

    app.on('activate', () => {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length === 0) {
        openMainWindow({ icon })
        return
      }
      openOrFocusMainWindow({ icon })
    })

    let designQuitPending = false
    let designShutdownComplete = false
    let cliShutdownComplete = false
    app.on('before-quit', (event) => {
      if (!designShutdownComplete) {
        event.preventDefault()
        if (!designQuitPending) {
          designQuitPending = true
          void prepareDesignQuit()
            .then((ready) => {
              if (ready) {
                designShutdownComplete = true
                app.quit()
              }
            })
            .catch((error) => console.error('Design save failed', error))
            .finally(() => {
              designQuitPending = false
            })
        }
        return
      }
      setAppQuitting(true)
      setWindowsTrayAvailable(false)
      windowsTrayService.stop()
      windowBadgeService.reset()
      terminalRelay.destroy()
      loroDataPlaneRelay.destroy()
      appUpdaterService.stop()
      publicBrowserService.destroyAll()

      if (cliShutdownComplete) {
        // Cleanup already ran on the first pass; let this quit proceed.
        cliService.killAllProcesses()
        return
      }

      // Defer the quit until the embedded CLI has actually exited. Killing it
      // fire-and-forget would let the app exit while the CLI is still shutting
      // down, orphaning it holding the local ports + terminal socket and breaking
      // the next launch. shutdownForQuit() SIGTERMs, waits briefly, then SIGKILLs.
      event.preventDefault()
      void Promise.allSettled([cliService.shutdownForQuit()]).finally(() => {
        cliShutdownComplete = true
        app.quit()
      })
    })

    process.on('exit', () => {
      setWindowsTrayAvailable(false)
      windowsTrayService.stop()
      terminalRelay.destroy()
      loroDataPlaneRelay.destroy()
      cliService.killAllProcesses()
      appUpdaterService.stop()
      publicBrowserService.destroyAll()
    })
  })
  void appReady.catch(async (error: unknown) => {
    recordE2EBootDiagnostic('failed', error)
    console.error('[Electron] Fatal error while creating the main window', error)
    if (!IS_E2E) {
      await shutdownDesignWorker()
      app.exit(1)
    }
  })
}

app.on('window-all-closed', () => {
  if (
    process.platform !== 'darwin' &&
    !process.argv.some((argument) => argument.startsWith('--molly-p0-verify='))
  ) {
    app.quit()
  }
})
