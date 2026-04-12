import { useMemo } from "react";
import type { ScheduleEvent, DelayNotice } from "../data/types";
import { getCurrentEvent } from "../data/useLiveData";
import { formatTime, getDelayForEvent, minsLate, formatLate } from "../data/utils";

interface ScheduleCardProps {
  events: ScheduleEvent[];
  delays: DelayNotice[];
  nowMins?: number;
}

const categoryLabel: Record<string, string> = {
  team: "Team",
  individual: "Individual",
  ceremony: "Ceremony",
  general: "General",
};

export function ScheduleCardExpanded({ events, delays, nowMins }: ScheduleCardProps) {
  const currentId = useMemo(() => getCurrentEvent(events, nowMins, delays), [events, nowMins, delays]);

  return (
    <div className="-mx-5 -my-4">
      {events.map((ev, i) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        const startTime = delay?.newTime ?? ev.startTime;
        const endTime = delay?.newEndTime ?? ev.endTime;

        return (
          <div
            key={ev.id}
            className={`px-5 py-3.5 ${i < events.length - 1 ? "border-b border-black/[0.06]" : ""} ${
              isCurrent ? "bg-california-gold/[0.06]" : ""
            }`}
          >
            {/* Top row: title + category badge */}
            <div className="flex items-center gap-2">
              {isCurrent && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-california-gold" />
                </span>
              )}
              <span className={`text-[15px] font-medium ${
                isCurrent ? "text-label" : "text-label"
              }`}>
                {ev.title}
              </span>
              {ev.category && ev.category !== "general" && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/5 text-tertiary-label">
                  {categoryLabel[ev.category] ?? ev.category}
                </span>
              )}
            </div>

            {/* Time + location */}
            {delay && (delay.newTime || delay.newEndTime) ? (<>
              <p className="mt-1 text-[12px] text-tertiary-label tabular-nums line-through">
                {formatTime(ev.startTime)} – {formatTime(ev.endTime)}
              </p>
              <p className="text-[12px] tabular-nums">
                <span className="font-semibold text-danger">{formatTime(startTime)} – {formatTime(endTime)}</span>
                <span className="text-tertiary-label"> · {ev.location}</span>
              </p>
            </>) : (
              <p className="mt-1 text-[12px] text-tertiary-label tabular-nums">
                {formatTime(ev.startTime)} – {formatTime(ev.endTime)} · {ev.location}
              </p>
            )}

            {/* Description */}
            {ev.description && (
              <p className="text-[13px] text-secondary-label leading-snug mt-1.5">
                {ev.description}
              </p>
            )}

            {/* Delay reason */}
            {delay && (
              <p className="text-[12px] text-danger mt-1.5 font-medium">
                {delay.newTime && formatLate(minsLate(ev.startTime, delay.newTime))}
                {delay.newTime && delay.reason && " · "}
                {delay.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
