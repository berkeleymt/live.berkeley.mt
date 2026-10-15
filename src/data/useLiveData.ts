import { useState, useEffect, useCallback, useRef } from "react";
import type { LiveData, DelayNotice } from "./types";
import { toMins } from "./utils";

const API_URL = import.meta.env.VITE_API_URL || "/api/live";
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
  const failCount = useRef(0);
  const request = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const fetchData = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      let url = API_URL;
      if (devNow != null) {
        // Send UTC ISO string without fractional seconds to match backend format
        const iso = new Date(devNow).toISOString().replace(/\.\d{3}Z$/, "Z");
        url += `?at=${encodeURIComponent(iso)}`;
      }
      const res = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextData: LiveData = await res.json();
      if (controller.signal.aborted) return;
      setData(nextData);
      hasData.current = true;
      setError(null);
      setStale(false);
      failCount.current = 0;
    } catch {
      if (controller.signal.aborted) return;
      failCount.current += 1;
      if (failCount.current >= STALE_THRESHOLD || !hasData.current) {
        setStale(true);
        // If we never got data, surface as a hard error too
        setError((prev) => prev ?? "Unable to connect");
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [devNow]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      request.current?.abort();
      request.current = null;
    };
  }, [fetchData]);

  return { data, error, stale, refresh: fetchData };
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
