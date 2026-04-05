import { useState, useEffect, useCallback } from "react";
import type { LiveData } from "./types";
import { mockData } from "./mock";

type DataSource = "mock" | "api";

const DATA_SOURCE: DataSource = "mock";
const _API_URL = "/api/live"; // placeholder for future backend

export function useLiveData() {
  const [data, setData] = useState<LiveData>(mockData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (DATA_SOURCE === "mock") {
      setData({ ...mockData, lastUpdated: new Date().toISOString() });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(_API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LiveData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (DATA_SOURCE === "api") {
      const interval = setInterval(refresh, 30_000);
      return () => clearInterval(interval);
    }
  }, [refresh]);

  return { data, loading, error, refresh };
}

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
