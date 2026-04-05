import { useState, useEffect, useCallback, useRef } from "react";
import type { LiveData } from "./types";
import { mockData } from "./mock";

/**
 * Live data hook.
 *
 * In development, returns static mock data (no network requests).
 * To connect to a real backend, set VITE_API_URL in your .env:
 *
 *   VITE_API_URL=https://api.berkeley.mt/live
 *
 * The endpoint should return JSON matching the LiveData interface.
 * When set, this hook polls the endpoint every POLL_INTERVAL ms.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const POLL_INTERVAL = 5_000; // 5 seconds for snappy sync

export function useLiveData() {
  const [data, setData] = useState<LiveData>(mockData);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchData = useCallback(async () => {
    if (!API_URL) return;

    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LiveData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    }
  }, []);

  useEffect(() => {
    if (!API_URL) return;

    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  return { data, error };
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
