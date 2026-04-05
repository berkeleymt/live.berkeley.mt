import { useMemo } from "react";
import type { ScheduleEvent, DelayNotice } from "../data/types";
import { getCurrentEvent, getNextEvent } from "../data/useLiveData";

interface ScheduleCardProps {
  events: ScheduleEvent[];
  delays: DelayNotice[];
}

const categoryColors: Record<ScheduleEvent["category"], string> = {
  individual: "bg-blue-100 text-blue-700",
  team: "bg-emerald-100 text-emerald-700",
  general: "bg-slate-100 text-slate-600",
  ceremony: "bg-amber-100 text-amber-700",
};

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
    if (!highlightId) return events.slice(0, 4);
    const idx = events.findIndex((e) => e.id === highlightId);
    const start = Math.max(0, idx - 1);
    return events.slice(start, start + 4);
  }, [events, highlightId]);

  return (
    <div className="space-y-1.5">
      {visibleEvents.map((ev) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        return (
          <div
            key={ev.id}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              isCurrent
                ? "bg-cal-california-gold/15 ring-1 ring-cal-california-gold/50"
                : "bg-slate-50"
            }`}
          >
            {isCurrent && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cal-medalist opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cal-medalist" />
              </span>
            )}
            <span className="text-muted w-16 shrink-0 tabular-nums">
              {delay ? (
                <span className="text-danger line-through mr-1">{formatTime(delay.originalTime)}</span>
              ) : null}
              {formatTime(delay ? delay.newTime : ev.startTime)}
            </span>
            <span className={`truncate ${isCurrent ? "text-heading font-medium" : "text-body"}`}>
              {ev.title}
            </span>
          </div>
        );
      })}
      {events.length > 4 && (
        <p className="text-[10px] text-muted text-center pt-1">
          Tap to see full schedule
        </p>
      )}
    </div>
  );
}

export function ScheduleCardExpanded({ events, delays }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events), [events]);

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        return (
          <div
            key={ev.id}
            className={`rounded-xl px-3 py-3 ${
              isCurrent
                ? "bg-cal-california-gold/15 ring-1 ring-cal-california-gold/50"
                : "bg-slate-50"
            }`}
          >
            <div className="flex items-start gap-2">
              {isCurrent && (
                <span className="relative flex h-2 w-2 shrink-0 mt-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cal-medalist opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cal-medalist" />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-heading font-medium text-sm">{ev.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${categoryColors[ev.category]}`}>
                    {ev.category}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted">
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
                  <span>{ev.location}</span>
                </div>
                {ev.description && (
                  <p className="text-xs text-muted mt-1.5 leading-relaxed">{ev.description}</p>
                )}
                {delay?.reason && (
                  <p className="text-xs text-danger mt-1">
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
