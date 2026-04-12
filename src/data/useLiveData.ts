import { useState, useEffect, useCallback, useRef } from "react";
import type { LiveData } from "./types";

const API_URL = import.meta.env.VITE_API_URL as string;
const POLL_INTERVAL = 5_000;
/** Show "stale" banner after this many consecutive failures. */
const STALE_THRESHOLD = 3;

export function useLiveData() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True when we have data but haven't been able to refresh it recently. */
  const [stale, setStale] = useState(false);
  const failCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
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
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  return { data, error, stale };
}

// ── Schedule helpers ──

export function getCurrentEvent(schedule: LiveData["schedule"]): string | null {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const ev of schedule) {
    const [sh, sm] = ev.startTime.split(":").map(Number);
    const [eh, em] = ev.endTime.split(":").map(Number);
    if (minutes >= sh * 60 + sm && minutes < eh * 60 + em) return ev.id;
  }
  return null;
}

export function getNextEvent(schedule: LiveData["schedule"]): string | null {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const ev of schedule) {
    const [sh, sm] = ev.startTime.split(":").map(Number);
    if (sh * 60 + sm > minutes) return ev.id;
  }
  return null;
}
