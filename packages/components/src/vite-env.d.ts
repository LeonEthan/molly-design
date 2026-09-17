/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts
declare const __BUILD_DATE__: string;
declare const __GIT_COMMIT__: string;
// Linked desktop/CLI version injected by the renderer build.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_PREVIEW_PUBLIC_BASE_DOMAIN: string;
  readonly VITE_SERVER_URL: string;
  readonly VITE_LORO_STREAMS_BASE_URL?: string;
  readonly VITE_SITE_URL?: string;
  /**
   * Escape hatch that pins the Machine RPC response live transport. Unset (the
   * normal build) uses the SSE-first policy with its long-poll fallback.
   */
  readonly VITE_LORO_STREAMS_RPC_LIVE_MODE?: 'sse' | 'long-poll';
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  /**
   * Build-time platform selection (specs/platform-providers.md): `local` for
   * the open-source build, `cloud`/unset for the official build. Read once via
   * `src/lib/app-platform.ts`.
   */
  readonly VITE_MOLLY_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
