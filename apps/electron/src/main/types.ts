import type {
  GetNotificationPermissionStatusResult,
  NotificationPermissionState,
  OpenSystemNotificationSettingsResult,
  ShowSessionCompletionNotificationInput,
  ShowSessionCompletionNotificationResult
} from '@molly/shared/electron-ipc'
import type { LocalProjectFileReadResult } from '@molly/shared/message'

export type {
  GetNotificationPermissionStatusResult,
  NotificationPermissionState,
  OpenSystemNotificationSettingsResult,
  ShowSessionCompletionNotificationInput,
  ShowSessionCompletionNotificationResult,
  LocalProjectFileReadResult
}

export type CliRunResult = {
  code: number | null
  signal?: NodeJS.Signals | null
  terminationKind?: 'exit' | 'signal' | 'v8_oom'
  stdout: string
  stderr: string
}

export type CliOutputStream = 'stdout' | 'stderr' | 'meta'

export type CliOutputEvent = {
  runId: string
  stream: CliOutputStream
  chunk: string
}

export type LocalProjectFileListResultInternal = {
  paths: string[]
  truncated: boolean
  source: 'git' | 'walk'
}
