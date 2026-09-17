import { resolvePlatformKind, type PlatformCapability, type PlatformKind } from '@molly/platform';
import { usePlatform } from '@molly/platform/react';

/**
 * The single build-time platform probe for GUI apps
 * (specs/platform-providers.md). Boot wiring (root providers, route gating,
 * runtime assembly) may branch on this; feature UI must consume capabilities
 * via the platform context instead of asking "which build is this".
 *
 * Any cloud or unrecognized value fails before rendering the product shell.
 */
let cachedKind: PlatformKind | null = null;

export function getAppPlatformKind(): PlatformKind {
  if (cachedKind === null) {
    const kind = resolvePlatformKind(import.meta.env.VITE_MOLLY_PLATFORM);
    if (kind !== 'local') {
      throw new Error('Molly desktop supports only the local platform');
    }
    cachedKind = kind;
  }
  return cachedKind;
}

export function isLocalAppPlatform(): boolean {
  return getAppPlatformKind() === 'local';
}

/**
 * Capability check for feature UI. Every app assembly must mount a complete
 * PlatformProvider; a missing provider is a programming error rather than an
 * implicit cloud fallback.
 */
export function useAppCapabilityCheck(): (capability: PlatformCapability) => boolean {
  const platform = usePlatform();
  return (capability) => platform.capabilities.has(capability);
}

export function useAppCapability(capability: PlatformCapability): boolean {
  return useAppCapabilityCheck()(capability);
}
