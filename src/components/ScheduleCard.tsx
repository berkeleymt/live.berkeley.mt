import { useMemo } from "react";
import type { ScheduleEvent, DelayNotice } from "../data/types";
import { getCurrentEvent, getNextEvent } from "../data/useLiveData";

interface ScheduleCardProps {
  events: ScheduleEvent[];
  delays: DelayNotice[];
}

const categoryStyles: Record<ScheduleEvent["category"], string> = {
  individual: "bg-founders-rock/10 text-founders-rock",
  team: "bg-berkeley-blue/10 text-berkeley-blue",
  general: "bg-ink/5 text-ink-light",
  ceremony: "bg-california-gold/15 text-medalist",
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
    <div className="space-y-1">
      {visibleEvents.map((ev) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        return (
          <div
            key={ev.id}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all ${
              isCurrent
                ? "bg-california-gold/12 ring-1 ring-california-gold/30"
                : "bg-surface/50"
            }`}
          >
            {isCurrent && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-medalist opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-medalist" />
              </span>
            )}
            <span className="text-ink-muted w-[4.5rem] shrink-0 tabular-nums font-body">
              {delay ? (
                <span className="text-danger line-through mr-1">{formatTime(delay.originalTime)}</span>
              ) : null}
              {formatTime(delay ? delay.newTime : ev.startTime)}
            </span>
            <span className={`truncate font-body ${isCurrent ? "text-ink font-600" : "text-ink-light"}`}>
              {ev.title}
            </span>
          </div>
        );
      })}
      {events.length > 4 && (
        <p className="text-[10px] text-ink-muted text-center pt-1 font-body tracking-wide">
          TAP TO SEE FULL SCHEDULE
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
            className={`rounded-xl px-4 py-3 transition-all ${
              isCurrent
                ? "bg-california-gold/12 ring-1 ring-california-gold/30"
                : "bg-surface/60"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {isCurrent && (
                <span className="relative flex h-2.5 w-2.5 shrink-0 mt-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-medalist opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-medalist" />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-600 text-sm text-ink">{ev.title}</span>
                  <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${categoryStyles[ev.category]}`}>
                    {ev.category}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-ink-muted font-body">
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
                  <span className="text-founders-rock">{ev.location}</span>
                </div>
                {ev.description && (
                  <p className="text-xs text-ink-light mt-1.5 leading-relaxed font-body">{ev.description}</p>
                )}
                {delay?.reason && (
                  <p className="text-xs text-danger mt-1 font-500">
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
