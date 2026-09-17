import { createContext, useContext } from 'react';
import type { CurrentUser } from '@/lib/current-user';

export type StableSessionValue = {
  data: { user: CurrentUser } | null;
};

const StableSessionContext = createContext<StableSessionValue | null>(null);

export { StableSessionContext };

export function useStableSession(): StableSessionValue {
  const context = useContext(StableSessionContext);
  if (!context) {
    throw new Error('useStableSession requires the local platform auth provider');
  }
  return context;
}
