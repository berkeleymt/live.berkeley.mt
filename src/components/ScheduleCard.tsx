import { useMemo } from "react";
import type { ScheduleEvent, DelayNotice } from "../data/types";
import { getCurrentEvent, getNextEvent } from "../data/useLiveData";

interface ScheduleCardProps {
  events: ScheduleEvent[];
  delays: DelayNotice[];
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function getDelayForEvent(eventId: string, delays: DelayNotice[]) {
  return delays.find((d) => d.eventId === eventId);
}

export function ScheduleCardCompact({ events, delays }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events), [events]);
  const nextId = useMemo(() => getNextEvent(events), [events]);
  const highlightId = currentId ?? nextId;

  const visibleEvents = useMemo(() => {
    const count = 4;
    if (!highlightId) return events.slice(0, count);
    const idx = events.findIndex((e) => e.id === highlightId);
    const start = Math.max(0, idx - 1);
    return events.slice(start, start + count);
  }, [events, highlightId]);

  return (
    <div className="-mx-4">
      {visibleEvents.map((ev, i) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        return (
          <div
            key={ev.id}
            className={`flex items-center gap-3 px-4 py-2 ${
              i < visibleEvents.length - 1 ? "border-b border-separator" : ""
            } ${isCurrent ? "bg-california-gold/8" : ""}`}
          >
            {isCurrent ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-california-gold" />
              </span>
            ) : (
              <span className="w-2 shrink-0" />
            )}
            <span className="text-[13px] text-tertiary-label w-[4.5rem] shrink-0 tabular-nums">
              {delay ? (
                <span className="text-danger line-through mr-1">{formatTime(delay.originalTime)}</span>
              ) : null}
              {formatTime(delay ? delay.newTime : ev.startTime)}
            </span>
            <span className={`text-[13px] truncate ${isCurrent ? "text-label font-semibold" : "text-secondary-label"}`}>
              {ev.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ScheduleCardExpanded({ events, delays }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events), [events]);

  return (
    <div className="-mx-5 -my-4">
      {events.map((ev, i) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        return (
          <div
            key={ev.id}
            className={`px-5 py-3.5 ${
              i < events.length - 1 ? "border-b border-separator" : ""
            } ${isCurrent ? "bg-california-gold/8" : ""}`}
          >
            <div className="flex items-start gap-3">
              {isCurrent ? (
                <span className="relative flex h-2 w-2 shrink-0 mt-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-california-gold" />
                </span>
              ) : (
                <span className="w-2 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[15px] ${isCurrent ? "font-semibold text-label" : "text-label"}`}>
                    {ev.title}
                  </span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-bg text-tertiary-label shrink-0">
                    {ev.category}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[13px] text-tertiary-label">
                  <span className="tabular-nums">
                    {delay ? (
                      <>
                        <span className="line-through text-danger mr-1">{formatTime(delay.originalTime)}</span>
                        {formatTime(delay.newTime)}
                      </>
                    ) : (
                      <>
                        {formatTime(ev.startTime)} – {formatTime(ev.endTime)}
                      </>
                    )}
                  </span>
                  <span className="text-link">{ev.location}</span>
                </div>
                {ev.description && (
                  <p className="text-[13px] text-secondary-label mt-1 leading-relaxed">{ev.description}</p>
                )}
                {delay?.reason && (
                  <p className="text-[13px] text-danger mt-1">
                    Delayed: {delay.reason}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
