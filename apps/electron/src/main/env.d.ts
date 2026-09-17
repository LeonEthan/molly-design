interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string
  readonly VITE_SITE_URL?: string
  readonly VITE_ELECTRON_UPDATE_URL?: string
  readonly VITE_ELECTRON_UPDATE_CHANNEL?: string
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
  readonly VITE_MOLLY_ENV?: string
  readonly VITE_MOLLY_PLATFORM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
