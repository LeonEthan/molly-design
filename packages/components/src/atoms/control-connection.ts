import { atom } from 'jotai';

export type MollyControlConnectionState =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'error';

export type MollyConnectionUiState = 'online' | 'loading' | 'offline' | 'reconnecting';

export const mollyControlConnectionStateAtom = atom<MollyControlConnectionState>('idle');

/**
 * Atom that tracks the browser's network status.
 * This provides a more immediate signal for offline detection than WebSocket state.
 *
 * Initial value is read from navigator.onLine. The RuntimeProvider updates this atom
 * when browser online/offline events fire.
 */
const getInitialOnlineState = () => {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
};
export const browserOnlineAtom = atom<boolean>(getInitialOnlineState());

/**
 * Whether the workspace runtime is still initializing locally.
 * This includes:
 * - Waiting for workspaceId (from cache or server)
 * - Creating the workspace runtime (IndexedDB / Loro repo)
 *
 * Goes false as soon as the local runtime is ready, independent of WebSocket
 * connection state (tracked by mollyControlConnectionStateAtom).
 */
export const runtimeInitializingAtom = atom<boolean>(true);

export const deriveMollyConnectionUiState = (args: {
  state: MollyControlConnectionState;
  runtimeInitializing?: boolean;
  browserOnline: boolean;
}): MollyConnectionUiState => {
  const { state, browserOnline } = args;

  if (state === 'online') return 'online';

  if (!browserOnline || state === 'offline') return 'offline';

  if (state === 'connecting' || state === 'syncing') return 'loading';

  if (state === 'reconnecting') return 'reconnecting';

  // 'idle' means connection hasn't been attempted yet (e.g. token not set).
  // With browser online, this is a transient startup state — show 'loading',
  // not 'offline'. True offline is caught by the !browserOnline check above.
  if (state === 'idle') return 'loading';

  return 'offline';
};

export const mollyConnectionUiStateAtom = atom<MollyConnectionUiState>((get) =>
  deriveMollyConnectionUiState({
    state: get(mollyControlConnectionStateAtom),
    runtimeInitializing: get(runtimeInitializingAtom),
    browserOnline: get(browserOnlineAtom),
  })
);
