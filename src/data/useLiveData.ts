import { useState, useEffect, useCallback, useRef } from "react";
import type { LiveData, DelayNotice } from "./types";
import { toMins } from "./utils";

const API_URL = import.meta.env.VITE_API_URL as string;
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
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchData = useCallback(async () => {
    try {
      let url = API_URL;
      if (devNow != null) {
        // Send UTC ISO string without fractional seconds to match backend format
        const iso = new Date(devNow).toISOString().replace(/\.\d{3}Z$/, "Z");
        url += `?at=${encodeURIComponent(iso)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
      setStale(false);
      failCount.current = 0;
    } catch (e) {
      failCount.current += 1;
      if (failCount.current >= STALE_THRESHOLD) {
        setStale(true);
        // If we never got data, surface as a hard error too
        setError((prev) => prev ?? "Unable to connect");
      }
    }
  }, [devNow]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  return { data, error, stale };
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
