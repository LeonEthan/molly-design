import { useEffect, useLayoutEffect, useRef } from 'react';

import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { LRUCache } from '@/lib/lru-cache';

const MAX_REMEMBERED_REVEALS = 100;
const spentReveals = new LRUCache<string, true>(MAX_REMEMBERED_REVEALS);

export const clearAgentBrowserRevealMemory = (): void => spentReveals.clear();

const spendReveal = (key: string): boolean => {
  if (spentReveals.has(key)) return false;
  spentReveals.set(key, true);
  return true;
};

type AgentBrowserAutoRevealOptions = {
  browserId: string | null;
  turnId: string | null;
  suppressed: boolean;
  onReveal: () => void;
};

/**
 * Calls `onReveal` the first time the Agent takes control of `browserId` in a
 * Turn. Later control transitions in the same Turn never reveal again, so a
 * user who closes the panel keeps it closed until the next Turn, even if the
 * session view remounts. A reveal opportunity spent while `suppressed` (Zen)
 * is not carried over.
 */
export function useAgentBrowserAutoReveal({
  browserId,
  turnId,
  suppressed,
  onReveal,
}: AgentBrowserAutoRevealOptions): void {
  const latestRef = useRef({ turnId, suppressed, onReveal });
  useLayoutEffect(() => {
    latestRef.current = { turnId, suppressed, onReveal };
  });

  useEffect(() => {
    if (!browserId) return undefined;
    const bridge = getPublicBrowserBridge();
    if (!bridge) return undefined;
    return bridge.onState((state) => {
      if (state.browserId !== browserId || state.agentControl !== 'agent') return;
      const latest = latestRef.current;
      if (!spendReveal(`${browserId}:${latest.turnId ?? ''}`)) return;
      if (!latest.suppressed) latest.onReveal();
    });
  }, [browserId]);
}
