import { useState, useEffect, useCallback, useRef } from "react";
import type { LiveData, DelayNotice } from "./types";
import { toMins } from "./utils";

const API_URL = import.meta.env?.VITE_API_URL || "/api/live";
const POLL_INTERVAL = 5_000;
/** Show "stale" banner after this many consecutive failures. */
const STALE_THRESHOLD = 3;

/**
 * @param devNow  When set (ms since epoch), the backend filters
 *                announcements/delays to only those before this instant.
 */
export function useLiveData(devNow?: number | null) {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True when we have data but haven't been able to refresh it recently. */
  const [stale, setStale] = useState(false);
  const [lastReceived, setLastReceived] = useState<number | null>(null);
  const hasData = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function load() {
      if (stopped || request) return;
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      try {
        let url = API_URL;
        if (devNow != null) {
          const iso = new Date(devNow).toISOString().replace(/\.\d{3}Z$/, "Z");
          url += `?at=${encodeURIComponent(iso)}`;
        }
        const res = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]), cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const nextData: LiveData = await res.json();
        if (stopped) return;
        setData(nextData); setLastReceived(Date.now()); hasData.current = true;
        setError(null); setStale(false); failures = 0;
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= STALE_THRESHOLD || !hasData.current) {
          setStale(true); setError("Unable to connect");
        }
      } finally {
        request = null;
        if (!stopped) timer = setTimeout(load, failures ? Math.random() * Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) : POLL_INTERVAL);
      }
    }
    refreshRef.current = () => { void load(); };
    void load();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); refreshRef.current = () => {}; };
  }, [devNow]);

  return { data, error, stale, lastReceived, refresh };
}

// ── Schedule helpers ──

function realMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function effectiveTimes(ev: LiveData["schedule"][0], delays: DelayNotice[]) {
  const delay = delays.find(d => d.eventId === ev.id);
  return {
    start: toMins(delay?.newTime ?? ev.startTime),
    end: toMins(delay?.newEndTime ?? ev.endTime),
  };
}

export function getCurrentEvent(schedule: LiveData["schedule"], nowMins = realMinutes(), delays: DelayNotice[] = []): string | null {
  for (const ev of schedule) {
    const { start, end } = effectiveTimes(ev, delays);
    if (nowMins >= start && nowMins < end) return ev.id;
  }
  return null;
}

export function getNextEvent(schedule: LiveData["schedule"], nowMins = realMinutes(), delays: DelayNotice[] = []): string | null {
  for (const ev of schedule) {
    const { start } = effectiveTimes(ev, delays);
    if (start > nowMins) return ev.id;
  }
  return null;
}
