export const MOLLY_APP_INFO_UPDATED_EVENT = 'lody:app-info-updated';

export type MollyNativeAppInfo = NonNullable<Window['__MOLLY_APP_INFO__']>;

export function readNativeAppInfo(): MollyNativeAppInfo {
  if (typeof window === 'undefined') {
    return {};
  }
  return window.__MOLLY_APP_INFO__ ?? {};
}

export function updateNativeAppInfo(info: MollyNativeAppInfo): MollyNativeAppInfo {
  if (typeof window === 'undefined') {
    return info;
  }

  const next = {
    ...(window.__MOLLY_APP_INFO__ ?? {}),
    ...info,
  };
  window.__MOLLY_APP_INFO__ = next;
  window.dispatchEvent(new CustomEvent(MOLLY_APP_INFO_UPDATED_EVENT, { detail: next }));
  return next;
}
