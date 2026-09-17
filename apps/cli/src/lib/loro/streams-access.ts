import { getLoroStreamsBaseUrl } from '@molly/shared';
import type { LoroStreamsTokenProvider } from '@molly/platform';

/**
 * Prime the platform token provider before reading its gateway. The hosted
 * token response owns deployment topology; CLI runtime modules must not invent
 * a default or require a second environment-based composition path.
 */
export async function prepareCliStreamsGatewayBaseUrl(
  tokenProvider: LoroStreamsTokenProvider
): Promise<string> {
  await tokenProvider.getToken();
  return getLoroStreamsBaseUrl(tokenProvider.getGatewayBaseUrl());
}
