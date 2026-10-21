import { createContext, useCallback, useContext } from 'react';
import type { SiteConfig } from './config';
import { siteDefaults, siteText } from './defaults';

/** Optional, read-only copy context. Never starts a request/poller (including previews/tests). */
export const SiteTextContext = createContext<SiteConfig | null>(null);
export function useSiteText(explicit?: SiteConfig) {
  const inherited = useContext(SiteTextContext);
  const content = explicit ?? inherited ?? siteDefaults;
  return useCallback((key: string, values?: Record<string, string | number>) => siteText(content, key, values), [content]);
}
