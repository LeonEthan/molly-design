import { useEffect, useLayoutEffect, useRef } from 'react';

import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';

import { useFireOncePerKey } from './use-fire-once';

type AgentBrowserAutoRevealOptions = {
  browserId: string | null;
  turnId: string | null;
  suppressed: boolean;
  onReveal: () => void;
};

/**
 * Calls `onReveal` the first time the Agent takes control of `browserId` in a
 * Turn. Later control transitions in the same Turn never reveal again, so a
 * user who closes the panel keeps it closed until the next Turn. A reveal
 * opportunity spent while `suppressed` (Zen) is not carried over.
 */
export function useAgentBrowserAutoReveal({
  browserId,
  turnId,
  suppressed,
  onReveal,
}: AgentBrowserAutoRevealOptions): void {
  const shouldReveal = useFireOncePerKey();
  const latestRef = useRef({ turnId, suppressed, onReveal, shouldReveal });
  useLayoutEffect(() => {
    latestRef.current = { turnId, suppressed, onReveal, shouldReveal };
  });

  useEffect(() => {
    if (!browserId) return undefined;
    const bridge = getPublicBrowserBridge();
    if (!bridge) return undefined;
    return bridge.onState((state) => {
      if (state.browserId !== browserId || state.agentControl !== 'agent') return;
      const latest = latestRef.current;
      if (!latest.shouldReveal(`${browserId}:${latest.turnId ?? ''}`)) return;
      if (!latest.suppressed) latest.onReveal();
    });
  }, [browserId]);
}
