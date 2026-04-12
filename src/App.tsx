import { useEffect, useMemo, useRef, useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useLiveData } from "./data/useLiveData";
import type { ScheduleEvent, DelayNotice } from "./data/types";
import { getCurrentEvent, getNextEvent } from "./data/useLiveData";
import { formatTime, getDelayForEvent, toMins } from "./data/utils";
import { LiveFeed } from "./components/LiveFeed";
import { WidgetCard } from "./components/WidgetCard";
import { staggerContainer, cardReveal } from "./components/springs";
import { ScheduleCardExpanded } from "./components/ScheduleCard";
import { MapCardCompact, MapCardExpanded } from "./components/MapCard";
import { InfoCardCompact, InfoCardExpanded } from "./components/InfoCard";

const IS_DEV = import.meta.env.DEV;

// ── Helpers ──

function getEventProgress(ev: ScheduleEvent, delays: DelayNotice[], nowMins?: number): number {
  const mins = nowMins ?? (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const delay = delays.find(d => d.eventId === ev.id);
  const start = toMins(delay?.newTime ?? ev.startTime);
  const end = toMins(delay?.newEndTime ?? ev.endTime);
  if (mins <= start) return 0;
  if (mins >= end) return 1;
  return (mins - start) / (end - start);
}

function getMinutesUntil(time: string, nowMins?: number): number {
  const mins = nowMins ?? (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  return toMins(time) - mins;
}

/** Convert minutes-since-midnight to ms-since-epoch (today, local). */
function minsToEpoch(mins: number): number {
  const d = new Date();
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.getTime();
}

/** Pretty-print minutes-since-midnight as "H:MM AM/PM". */
function minsToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

// ── Header Widget ──

function HeaderWidget() {
  return (
    <div className="bg-berkeley-blue text-white widget-shadow overflow-hidden flex items-center rounded-2xl">
      <div className="px-5 py-4 flex items-center gap-4 w-full">
        <img src="/bmt-logo.svg" alt="BMT" className="h-12 w-12 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-white/50 font-medium tracking-widest uppercase">
            Sunday, April 12
          </p>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight text-wrap-balance">
            BmMT 2026
          </h1>
        </div>
        <div className="flex items-center gap-1.5 bg-white/10 rounded-full pl-2.5 pr-3 py-1 shrink-0">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
          </span>
          <span className="text-[11px] font-semibold text-white/90">
            Live
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Now Hero ──

function NowHero({ events, delays, nowMins, showScheduleHint }: { events: ScheduleEvent[]; delays: DelayNotice[]; nowMins?: number; showScheduleHint?: boolean }) {
  const currentId = useMemo(() => getCurrentEvent(events, nowMins, delays), [events, nowMins, delays]);
  const nextId = useMemo(() => getNextEvent(events, nowMins, delays), [events, nowMins, delays]);

  const current = currentId ? events.find((e) => e.id === currentId) : null;
  const next = nextId ? events.find((e) => e.id === nextId) : null;
  const progress = current ? getEventProgress(current, delays, nowMins) : 0;
  const currentDelay = current ? getDelayForEvent(current.id, delays) : undefined;

  if (!current && !next) {
    return (
      <div className="h-full glass-heavy widget-shadow px-5 py-6 text-center flex flex-col items-center justify-center">
        <p className="text-[15px] font-semibold text-label">All done for today!</p>
        <p className="text-[13px] text-tertiary-label mt-1">Thanks for coming to BmMT 2026</p>
      </div>
    );
  }

  return (
    <div className="h-full glass-heavy widget-shadow overflow-hidden flex flex-col justify-center">
      {current ? (
        <div className="px-5 py-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-california-gold" />
            </span>
            <span className="text-[12px] font-bold uppercase tracking-wider text-california-gold">
              Happening Now
            </span>
          </div>

          <h2 className="text-[22px] font-bold text-label leading-tight tracking-tight">
            {current.title}
          </h2>
          {currentDelay && (currentDelay.newTime || currentDelay.newEndTime) ? (() => {
            const newStart = currentDelay.newTime ?? current.startTime;
            const newEnd = currentDelay.newEndTime ?? current.endTime;
            const startChanged = newStart !== current.startTime;
            const endChanged = newEnd !== current.endTime;
            return <>
              <p className="text-[15px] text-tertiary-label line-through mt-1 tabular-nums">
                {formatTime(current.startTime)} – {formatTime(current.endTime)}
              </p>
              <p className="text-[15px] tabular-nums">
                <span className={startChanged ? "text-danger" : "text-secondary-label"}>{formatTime(newStart)}</span>
                <span className="text-secondary-label"> – </span>
                <span className={endChanged ? "text-danger" : "text-secondary-label"}>{formatTime(newEnd)}</span>
                <span className="text-tertiary-label"> · {current.location}</span>
              </p>
            </>;
          })() : (
            <p className="text-[15px] text-secondary-label mt-1 tabular-nums">
              {formatTime(current.startTime)} – {formatTime(current.endTime)}
              <span className="text-tertiary-label"> · {current.location}</span>
            </p>
          )}
          {currentDelay?.reason && (
            <p className="text-[12px] text-danger mt-1 font-medium">
              {currentDelay.reason}
            </p>
          )}

          {/* Progress bar */}
          <div className="mt-4 h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-california-gold rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ type: "spring", duration: 0.8, bounce: 0 }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] text-tertiary-label tabular-nums">
            <span>{formatTime(currentDelay?.newTime ?? current.startTime)}</span>
            <span>{Math.round(progress * 100)}%</span>
            <span>{formatTime(currentDelay?.newEndTime ?? current.endTime)}</span>
          </div>
        </div>
      ) : next && (
        <div className="px-5 py-5">
          <span className="text-[12px] font-bold uppercase tracking-wider text-tertiary-label">
            Up Next
          </span>
          <h2 className="text-[22px] font-bold text-label leading-tight tracking-tight mt-2">
            {next.title}
          </h2>
          <p className="text-[15px] text-secondary-label mt-1 tabular-nums">
            {formatTime(next.startTime)} – {formatTime(next.endTime)}
            <span className="text-tertiary-label"> · {next.location}</span>
          </p>
          {(() => {
            const nextDelay = getDelayForEvent(next.id, delays);
            const mins = getMinutesUntil(nextDelay?.newTime ?? next.startTime, nowMins);
            if (mins > 0 && mins < 120) {
              return (
                <p className="text-[13px] text-california-gold font-semibold mt-2 tabular-nums">
                  Starts in {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
                </p>
              );
            }
            return null;
          })()}
        </div>
      )}
      {showScheduleHint && (
        <div className="px-5 pb-4 pt-1 flex items-center justify-center gap-1.5 text-[12px] text-tertiary-label">
          <span>View full schedule</span>
          <span className="text-[10px]">›</span>
        </div>
      )}
    </div>
  );
}

// ── Schedule Timeline ──

function ScheduleTimeline({ events, delays, nowMins }: { events: ScheduleEvent[]; delays: DelayNotice[]; nowMins?: number }) {
  const currentId = useMemo(() => getCurrentEvent(events, nowMins, delays), [events, nowMins, delays]);

  return (
    <div className="space-y-0">
      {events.map((ev, i) => {
        const isCurrent = ev.id === currentId;
        const delay = getDelayForEvent(ev.id, delays);
        const isLast = i === events.length - 1;

        return (
          <div key={ev.id} className="flex gap-3">
            {/* Timeline column */}
            <div className="flex flex-col items-center w-10 shrink-0">
              <div className="my-1.5">
                {isCurrent ? (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-california-gold" />
                  </span>
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-quaternary-label/50 block" />
                )}
              </div>
              {!isLast && (
                <div className={`w-px flex-1 ${isCurrent ? "bg-california-gold/30" : "bg-separator"}`} />
              )}
            </div>

            {/* Event content */}
            <div className={`pb-4 flex-1 min-w-0 ${isLast ? "" : ""}`}>
              <p className={`text-[14px] font-semibold leading-tight ${
                isCurrent ? "text-label" : "text-secondary-label"
              }`}>
                {ev.title}
              </p>
              {delay && (delay.newTime || delay.newEndTime) ? (() => {
                const newStart = delay.newTime ?? ev.startTime;
                const newEnd = delay.newEndTime ?? ev.endTime;
                const startChanged = newStart !== ev.startTime;
                const endChanged = newEnd !== ev.endTime;
                return <>
                  <p className="text-[12px] tabular-nums mt-0.5 line-through text-tertiary-label">
                    {formatTime(ev.startTime)} – {formatTime(ev.endTime)}
                  </p>
                  <p className="text-[12px] tabular-nums">
                    <span className={startChanged ? "text-danger" : "text-tertiary-label"}>{formatTime(newStart)}</span>
                    <span className="text-tertiary-label"> – </span>
                    <span className={endChanged ? "text-danger" : "text-tertiary-label"}>{formatTime(newEnd)}</span>
                    <span className="text-tertiary-label"> · {ev.location}</span>
                  </p>
                </>;
              })() : (
                <p className={`text-[12px] tabular-nums mt-0.5 ${
                  isCurrent ? "text-secondary-label" : "text-tertiary-label"
                }`}>
                  {formatTime(ev.startTime)} – {formatTime(ev.endTime)}
                  <span className="text-tertiary-label"> · {ev.location}</span>
                </p>
              )}
              {delay?.reason && (
                <p className="text-[12px] text-danger mt-0.5 font-medium">
                  {delay.reason}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Dev Time Slider ──

function DevTimeSlider({ value, onChange }: { value: number; onChange: (v: number | null) => void }) {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!playing) {
      clearInterval(intervalRef.current);
      return;
    }
    // 300x speed: advance 1 min every 200ms
    let cur = value;
    intervalRef.current = setInterval(() => {
      cur += 1;
      if (cur > 1140) { setPlaying(false); onChange(1140); return; }
      onChange(cur);
    }, 200);
    return () => clearInterval(intervalRef.current);
  }, [playing, onChange, value]);

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-gray-900/95 text-white backdrop-blur-sm px-4 py-2 flex items-center gap-2">
      <button
        onClick={() => onChange(null)}
        className="text-[11px] font-mono bg-white/10 hover:bg-white/20 rounded px-2 py-0.5 shrink-0"
      >
        Live
      </button>
      <button
        onClick={() => { if (!playing && value >= 1140) onChange(420); setPlaying(!playing); }}
        className="text-[13px] bg-white/10 hover:bg-white/20 rounded w-7 h-7 flex items-center justify-center shrink-0"
        title={playing ? "Pause" : "Play 60x"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <input
        type="range"
        min={420} max={1140} step={1}
        value={value}
        onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)); }}
        className="flex-1 accent-california-gold h-1.5"
      />
      <span className="text-[15px] font-mono font-semibold tabular-nums w-24 text-right shrink-0">
        {minsToLabel(value)}
      </span>
    </div>
  );
}

// ── Main App ──

/** Check if the viewport is tall enough for tall cards (row-span-3 instead of 2). */
function useTallCards(gridRef: React.RefObject<HTMLDivElement | null>) {
  const [tall, setTall] = useState(false);

  useEffect(() => {
    const check = () => {
      const el = gridRef.current;
      if (!el || !window.matchMedia("(min-width: 1024px)").matches) {
        setTall(false);
        return;
      }
      const w = el.clientWidth;
      const gap = 18;
      const rowH = (w - gap * 3) / 4;
      const tallHeight = 60 + 12 + 4 * rowH + 3 * gap + 24 + 32;
      setTall(window.innerHeight >= tallHeight);
    };

    // Check once the ref is available (may need a frame for layout)
    requestAnimationFrame(check);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  });

  return tall;
}

export default function App() {
  // Dev time slider state — null means "use real time"
  const [devMins, setDevMins] = useState<number | null>(null);
  const devNow = devMins != null ? minsToEpoch(devMins) : null;
  const nowMins = devMins ?? undefined;

  const { data, error, stale } = useLiveData(devNow);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tallCards = useTallCards(gridRef);
  const tallSpan = tallCards ? "col-span-2 row-span-3 h-full" : "col-span-2 row-span-2 h-full";

  if (!data) return (
    <div className="min-h-dvh flex items-center justify-center">
      {error
        ? <p className="text-secondary-label text-center px-4">{error}</p>
        : (
          <div className="flex flex-col items-center gap-4">
            <motion.img
              src="/bmt-logo.svg"
              alt=""
              className="h-16 w-16"
              animate={{ rotate: 360 }}
              transition={{
                repeat: Infinity,
                ease: [0.25, 0.1, 0.25, 1],
                duration: 4,
              }}
            />
            <p className="text-secondary-label">Loading...</p>
          </div>
        )}
    </div>
  );

  return (
    <LayoutGroup>
    <div className={`min-h-dvh lg:flex lg:flex-col lg:justify-center relative`}>
      <div
        className="fixed inset-0 bg-center bg-cover bg-no-repeat pointer-events-none opacity-[0.08] -z-10"
        style={{ backgroundImage: "url(/bg-doodles.png)" }}
      />

      {stale && (
        <div className="fixed top-0 inset-x-0 z-50 bg-danger/90 text-white text-center text-[13px] font-medium py-1.5 px-4 backdrop-blur-sm">
          Not receiving updates — check your connection
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-6 pb-8 lg:max-w-6xl lg:px-6 lg:py-6 lg:w-full">
        <div className="widget-grid-container" ref={gridRef}>
          {/* Header strip */}
          <motion.div
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.35 }}
            className="mb-3"
          >
            <HeaderWidget />
          </motion.div>

          <motion.div
            className="widget-grid"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {/* NowHero — on mobile: WidgetCard that expands to schedule. On desktop: plain card */}
            <motion.div variants={cardReveal} className="col-span-2 h-full order-first lg:order-none">
              {/* Mobile: wrapped in WidgetCard for proper expand animation */}
              <div className="h-full lg:hidden">
                <WidgetCard
                  id="now-schedule"
                  title="Schedule"
                  icon="📅"
                  expandedId={expandedId}
                  onExpand={setExpandedId}
                  onCollapse={() => setExpandedId(null)}
                  expandedContent={<ScheduleCardExpanded events={data.schedule} delays={data.delays} nowMins={nowMins} />}
                >
                  <NowHero events={data.schedule} delays={data.delays} nowMins={nowMins} showScheduleHint />
                </WidgetCard>
              </div>
              {/* Desktop: plain NowHero */}
              <div className="h-full hidden lg:block">
                <NowHero events={data.schedule} delays={data.delays} nowMins={nowMins} />
              </div>
            </motion.div>

            {/* Live Feed — spans 2 or 3 rows depending on viewport */}
            <motion.div variants={cardReveal} className={tallSpan}>
              <WidgetCard
                id="livefeed"
                title="Live Feed"
                icon="📣"
                expandedId={expandedId}
                onExpand={setExpandedId}
                onCollapse={() => setExpandedId(null)}
              >
                <LiveFeed announcements={data.announcements} devNow={devNow} />
              </WidgetCard>
            </motion.div>

            {/* Schedule — desktop only */}
            <motion.div variants={cardReveal} className={`${tallSpan} hidden lg:block`}>
              <WidgetCard
                id="schedule"
                title="Schedule"
                icon="📅"
                expandedId={expandedId}
                onExpand={setExpandedId}
                onCollapse={() => setExpandedId(null)}
                expandedContent={
                  <ScheduleCardExpanded events={data.schedule} delays={data.delays} nowMins={nowMins} />
                }
              >
                <div className="flex flex-col h-full">
                  <div className="px-5 py-3 border-b border-black/[0.06] shrink-0">
                    <h2 className="text-[13px] font-semibold text-tertiary-label uppercase tracking-wider">
                      Full Schedule
                    </h2>
                  </div>
                  <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1">
                    <ScheduleTimeline events={data.schedule} delays={data.delays} nowMins={nowMins} />
                  </div>
                </div>
              </WidgetCard>
            </motion.div>

            {/* Map + Info — square pair */}
            <motion.div variants={cardReveal} className="h-full">
              <WidgetCard
                id="map"
                title="Campus Map"
                icon="📍"
                expandedId={expandedId}
                onExpand={setExpandedId}
                onCollapse={() => setExpandedId(null)}
                expandedVariant="fullscreen"
                expandedContent={<MapCardExpanded venues={data.venues} />}
              >
                <MapCardCompact venues={data.venues} />
              </WidgetCard>
            </motion.div>

            <motion.div variants={cardReveal} className="h-full">
              <WidgetCard
                id="info"
                title="Info & Help"
                icon="📋"
                expandedId={expandedId}
                onExpand={setExpandedId}
                onCollapse={() => setExpandedId(null)}
                expandedContent={<InfoCardExpanded info={data.info} />}
              >
                <InfoCardCompact info={data.info} />
              </WidgetCard>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Dev time slider — only in dev mode */}
      {IS_DEV && (
        <DevTimeSlider
          value={devMins ?? (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })()}
          onChange={setDevMins}
        />
      )}

    </div>
    <div id="overlay-root" />
    </LayoutGroup>
  );
}
