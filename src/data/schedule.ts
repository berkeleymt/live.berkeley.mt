import type { DelayNotice, EventContent, ScheduleEvent } from "./types.ts";
import { toMins } from "./utils.ts";

export function effectiveEvent(event: ScheduleEvent, delays: DelayNotice[]) {
  const delay = delays.find((item) => item.eventId === event.id);
  return {
    ...event,
    startTime: delay?.newTime ?? event.startTime,
    endTime: delay?.newEndTime ?? event.endTime,
    delay,
  };
}

export function eventDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function scheduleState(
  schedule: ScheduleEvent[],
  delays: DelayNotice[],
  event: Pick<EventContent, "date" | "timeZone">,
  now = Date.now(),
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  const events = schedule
    .map((item) => effectiveEvent(item, delays))
    .sort((a, b) => toMins(a.startTime) - toMins(b.startTime));
  const phase =
    events.length === 0
      ? "unpublished"
      : date < event.date
        ? "before"
        : date > event.date
          ? "after"
          : "today";
  const current =
    phase === "today"
      ? events.find(
          (item) =>
            toMins(item.startTime) <= minutes && toMins(item.endTime) > minutes,
        )
      : undefined;
  const next =
    phase === "before"
      ? events[0]
      : phase === "today"
        ? events.find((item) => toMins(item.startTime) > minutes)
        : undefined;
  return { phase, current, next, events, minutes };
}
