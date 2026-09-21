/**
 * URL schemes the desktop shell accepts for OS-delivered deep links.
 * `molly-design:` is the scheme the Molly build registers (electron-builder
 * `protocols`, installation profile `desktopProtocol`); `lody:` stays accepted
 * for links produced by the upstream cloud profile and older installs.
 */
const DESKTOP_DEEP_LINK_PROTOCOLS = new Set(['molly-design:', 'lody:']);

export function isDesktopDeepLinkProtocol(protocol: string): boolean {
  return DESKTOP_DEEP_LINK_PROTOCOLS.has(protocol);
}
