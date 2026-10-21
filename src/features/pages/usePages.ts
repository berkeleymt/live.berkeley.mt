import { useCallback, useEffect, useRef, useState } from 'react';
import { siteRequest } from '../site/api';
import { parsePagesDocument, type PagesDocument } from './model';

/** Pages are never bundled as a fallback: an unavailable endpoint is not an empty install. */
export function usePages() {
  const [document, setDocument] = useState<PagesDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    let failures = 0;
    async function load() {
      if (stopped || request) return;
      clearTimeout(timer);
      request = new AbortController();
      try {
        const next = parsePagesDocument(await siteRequest('/api/pages', { signal: request.signal }));
        if (stopped) return;
        setDocument(next); setError(next.reloadError); failures = 0;
      } catch (cause) {
        if (stopped) return;
        failures += 1; setError(cause instanceof Error ? cause.message : 'Cannot load published pages.');
      } finally {
        request = null;
        if (!stopped) timer = setTimeout(load, failures ? Math.random() * Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) : 30000);
      }
    }
    refreshRef.current = () => { void load(); };
    void load();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); refreshRef.current = () => {}; };
  }, []);
  return { document, error, refresh };
}
