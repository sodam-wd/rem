import { createContext, useContext } from 'react';
import type { RemApi } from './contracts';

/** Leader-owned. UI uses useRem(); dev/test mocks may render <RemContext.Provider value={mock}>. */
export const RemContext = createContext<RemApi | null>(null);

export function useRem(): RemApi {
  const api = useContext(RemContext);
  if (!api) throw new Error('useRem() must be used inside <RemProvider>');
  return api;
}
