/** Molly has one desktop shell. These compatibility helpers remain for
 * shared UI call sites while native-only branches are retired. */
export function isNativeAppShell(): boolean {
  return false;
}

export function isIOSRuntimeEnvironment(): boolean {
  return false;
}

export function isNativeIOSAppShell(): boolean {
  return false;
}

export function shouldEnableSidebarSwipeOpenGesture(_environment: {
  isNativeShell: boolean;
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  return false;
}

export function canUseSidebarSwipeOpenGesture(): boolean {
  return false;
}
