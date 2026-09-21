import { isDesktopDeepLinkProtocol } from './desktop-deep-link-protocol';

const DEEP_LINK_HOST = 'machine';
const DEEP_LINK_PATH = '/connect';

export function readDesktopMachinePairingRequestId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      !isDesktopDeepLinkProtocol(url.protocol) ||
      url.hostname !== DEEP_LINK_HOST ||
      url.pathname !== DEEP_LINK_PATH
    ) {
      return null;
    }
    const requestId = url.searchParams.get('requestId')?.trim();
    return requestId || null;
  } catch {
    return null;
  }
}
