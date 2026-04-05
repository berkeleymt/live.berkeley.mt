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

function getProgress(events: ScheduleEvent[]): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (events.length === 0) return 0;

  const [sh, sm] = events[0].startTime.split(":").map(Number);
  const last = events[events.length - 1];
  const [eh, em] = last.endTime.split(":").map(Number);

  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (mins <= start) return 0;
  if (mins >= end) return 1;
  return (mins - start) / (end - start);
}

export function ScheduleCardCompact({ events, delays }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events), [events]);
  const nextId = useMemo(() => getNextEvent(events), [events]);
  const progress = useMemo(() => getProgress(events), [events]);

  const heroEvent = useMemo(() => {
    const id = currentId ?? nextId;
    return id ? events.find((e) => e.id === id) : events[0];
  }, [events, currentId, nextId]);

  const isNow = heroEvent?.id === currentId;
  const heroDelay = heroEvent ? getDelayForEvent(heroEvent.id, delays) : undefined;

  const pct = Math.round(progress * 100);
  const circ = 2 * Math.PI * 18; // r=18

  return (
    <div className="h-full p-5 flex gap-4">
      {/* Left: text content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Status badge */}
        <div className="flex items-center gap-2 mb-auto">
          {isNow && (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-california-gold" />
            </span>
          )}
          <span className="text-[13px] font-bold uppercase tracking-wide text-california-gold">
            {isNow ? "Now" : "Up Next"}
          </span>
        </div>

        {/* Hero event */}
        {heroEvent && (
          <div>
            <p className="text-[24px] font-bold text-label leading-[1.1] tracking-tight">
              {heroEvent.title}
            </p>
            <p className="text-[17px] tabular-nums font-semibold text-secondary-label mt-1.5">
              {heroDelay ? (
                <>
                  <span className="text-danger line-through">{formatTime(heroDelay.originalTime)}</span>
                  {" "}
                  <span className="text-label">{formatTime(heroDelay.newTime)}</span>
                </>
              ) : (
                <>{formatTime(heroEvent.startTime)} – {formatTime(heroEvent.endTime)}</>
              )}
            </p>
            <p className="text-[14px] text-tertiary-label mt-1 truncate">
              📍 {heroEvent.location}
            </p>
          </div>
        )}
      </div>

      {/* Right: progress ring */}
      <div className="flex items-start pt-1 shrink-0">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="18" fill="none" stroke="currentColor" strokeWidth="4" className="text-separator" />
          <circle
            cx="26" cy="26" r="18"
            fill="none" stroke="currentColor" strokeWidth="4"
            className="text-california-gold"
            strokeLinecap="round"
            strokeDasharray={`${progress * circ} ${circ}`}
            transform="rotate(-90 26 26)"
          />
          <text x="26" y="27" textAnchor="middle" dominantBaseline="central" className="fill-label text-[13px] font-bold">
            {pct}%
          </text>
        </svg>
      </div>
    </div>
  );
}

export function ScheduleCardExpanded({ events, delays }: ScheduleCardProps) {
  return (
    <div className="-mx-5 -my-4 px-5 py-4">
      <ScheduleTimeline events={events} delays={delays} />
    </div>
  );
}

/** Standalone sidebar panel for desktop — always-visible schedule */
export function SchedulePanel({ events, delays }: ScheduleCardProps) {
  return (
    <div className="glass-heavy widget-shadow-lg h-full flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-white/20 shrink-0">
        <h2 className="text-[15px] font-semibold text-label tracking-tight">
          📅 Schedule
        </h2>
      </div>
      <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1">
        <ScheduleTimeline events={events} delays={delays} />
      </div>
    </div>
  );
}

function ScheduleTimeline({ events, delays }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events), [events]);

  return (
    <div className="-mx-5 -my-4 px-5 py-4">
      {events.map((ev, i) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        const isLast = i === events.length - 1;
        const startTime = delay ? delay.newTime : ev.startTime;

        return (
          <div key={ev.id} className="flex gap-4">
            {/* Time + dot column */}
            <div className="flex flex-col items-center w-12 shrink-0">
              <span className={`text-[11px] tabular-nums leading-none ${
                isCurrent ? "text-california-gold font-bold" : "text-tertiary-label font-medium"
              }`}>
                {formatTime(startTime).replace(" ", "\n").split("\n")[0]}
              </span>
              <span className={`text-[9px] tabular-nums ${
                isCurrent ? "text-california-gold font-bold" : "text-tertiary-label"
              }`}>
                {formatTime(startTime).split(" ")[1]}
              </span>
              <div className="my-1.5 relative">
                {isCurrent ? (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-california-gold" />
                  </span>
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-quaternary-label/50 shrink-0" />
                )}
              </div>
              {!isLast && (
                <div className={`w-px flex-1 ${isCurrent ? "bg-california-gold/30" : "bg-separator"}`} />
              )}
            </div>

            {/* Event card */}
            <div className={`rounded-xl px-3.5 py-3 ${
              isCurrent ? "bg-california-gold/10" : "bg-white/50"
            } mb-3 flex-1 min-w-0`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-[14px] font-semibold leading-tight ${
                    isCurrent ? "text-label" : "text-secondary-label"
                  }`}>
                    {ev.title}
                  </p>
                  <p className="text-[12px] text-tertiary-label mt-0.5 tabular-nums">
                    {formatTime(startTime)} – {formatTime(ev.endTime)}
                  </p>
                  <p className="text-[12px] text-tertiary-label">{ev.location}</p>
                </div>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/5 text-tertiary-label shrink-0">
                  {ev.category}
                </span>
              </div>
              {ev.description && (
                <p className={`text-[12px] mt-2 leading-snug ${
                  isCurrent ? "text-secondary-label" : "text-tertiary-label"
                }`}>
                  {ev.description}
                </p>
              )}
              {delay && (
                <p className="text-[12px] text-danger mt-1.5 font-medium">
                  Delayed: {delay.reason}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
