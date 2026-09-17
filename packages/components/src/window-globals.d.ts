import type { LoroRepo } from 'loro-repo';
import type { LoroDoc } from 'loro-crdt';
import type { CodeCollabDebugGlobal } from './lib/code-collab-global-debug';

declare global {
  interface Window {
    repo?: LoroRepo;
    currentSessionDoc?: LoroDoc;
    currentCodeCollab?: CodeCollabDebugGlobal;
    __MOLLY_ELECTRON__?: true;
    __MOLLY_PLATFORM__?: {
      os: string;
      homeDir: string;
      machineName?: string;
      preferredSystemLanguages?: readonly string[];
    };
    __MOLLY_APP_INFO__?: {
      version?: string;
      build?: string;
      native_platform?: string;
      os_name?: string;
      os_version?: string;
      app_version?: string;
      install_id?: string;
    };
    ipc?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (payload: unknown) => void) => () => void;
      send: (channel: string, payload?: unknown) => void;
    };
  }
}
