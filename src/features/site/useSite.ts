import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSiteDocument } from './config';
import type { SiteDocument } from './config';
import { siteDefaults } from './defaults';
import { siteRequest } from './api';

/** One request in flight per mounted hook, 15 s timeout, last-good content, full-jitter retry. */
export function useSite() {
  const [document, setDocument] = useState<SiteDocument | null>(null);
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
      const controller = new AbortController();
      request = controller;
      try {
        const next = parseSiteDocument(await siteRequest('/api/site', { signal: controller.signal }));
        if (stopped) return;
        setDocument(next); setError(null); failures = 0;
      } catch (cause) {
        if (stopped) return;
        failures += 1;
        setError(cause instanceof Error ? cause.message : 'Cannot load site content.');
      } finally {
        request = null;
        if (!stopped) timer = setTimeout(load, failures ? Math.random() * Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) : 30000);
      }
    }
    refreshRef.current = () => { void load(); };
    void load();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); refreshRef.current = () => {}; };
  }, []);
  return { document, content: document?.content ?? siteDefaults, loading: !document && !error, error, stale: !!document && !!error, refresh };
}
