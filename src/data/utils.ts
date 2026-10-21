import type { DelayNotice } from "./types";

export function timeZoneLabel(timeZone: string, date: string) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date(`${date}T12:00:00Z`)).find(part => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch { return timeZone; }
}

/** "14:30" → "2:30 PM" */
export function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

/** "HH:mm" → minutes since midnight */
export function toMins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Relative time string for a timestamp */
export function timeAgo(timestamp: string) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/** Find the delay notice for a given event */
export function getDelayForEvent(eventId: string, delays: DelayNotice[]) {
  return delays.find((d) => d.eventId === eventId);
}

/** How many minutes late an event is */
export function minsLate(original: string, delayed: string): number {
  return toMins(delayed) - toMins(original);
}

/** Format a lateness value: "15m late", "1h 30m late" */
export function formatLate(mins: number): string {
  if (mins <= 0) return "";
  if (mins < 60) return `${mins}m late`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m late` : `${h}h late`;
}
