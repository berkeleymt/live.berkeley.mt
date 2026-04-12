import { useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useLiveData } from "./data/useLiveData";
import type { LiveData } from "./data/types";
import { WidgetCard } from "./components/WidgetCard";
import { staggerContainer, cardReveal } from "./components/springs";
import { ScheduleCardCompact, ScheduleCardExpanded, SchedulePanel } from "./components/ScheduleCard";
import { AnnouncementsCardCompact, AnnouncementsCardExpanded } from "./components/AnnouncementsCard";
import { DelaysCardCompact, DelaysCardExpanded } from "./components/DelaysCard";
import { MapCardCompact, MapCardExpanded } from "./components/MapCard";
import { InfoCardCompact, InfoCardExpanded } from "./components/InfoCard";


function HeaderWidget() {
  return (
    <div className="h-full bg-berkeley-blue text-white widget-shadow overflow-hidden flex items-center">
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

function WidgetGrid({
  data,
  expandedId,
  setExpandedId,
  hasDelays,
}: {
  data: LiveData;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  hasDelays: boolean;
}) {
  return (
    <div className="widget-grid-container">
      {/* Header — branding card, outside the grid */}
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
        {/* Announcements — always first, wide */}
        <motion.div variants={cardReveal} className="col-span-2 h-full">
          <WidgetCard
            id="announcements"
            title="Announcements"
            icon="📣"
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            expandedVariant="list"
            expandedContent={
              <AnnouncementsCardExpanded announcements={data.announcements} />
            }
          >
            <AnnouncementsCardCompact announcements={data.announcements} />
          </WidgetCard>
        </motion.div>

        {/* Delays — wide banner, only when active */}
        {hasDelays && (
          <motion.div variants={cardReveal} className="col-span-2 h-full">
            <WidgetCard
              id="delays"
              title="Delays"
              icon="⚠️"
              expandedId={expandedId}
              onExpand={setExpandedId}
              onCollapse={() => setExpandedId(null)}
              expandedContent={<DelaysCardExpanded delays={data.delays} />}
            >
              <DelaysCardCompact delays={data.delays} />
            </WidgetCard>
          </motion.div>
        )}

        {/* Schedule — hidden on desktop (shown in sidebar instead) */}
        <motion.div variants={cardReveal} className="col-span-2 h-full lg:hidden">
          <WidgetCard
            id="schedule"
            title="Schedule"
            icon="📅"
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            expandedContent={
              <ScheduleCardExpanded events={data.schedule} delays={data.delays} />
            }
          >
            <ScheduleCardCompact events={data.schedule} delays={data.delays} />
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
  );
}

export default function App() {
  const { data, error, stale } = useLiveData();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!data) return (
    <div className="min-h-dvh flex items-center justify-center">
      {error
        ? <p className="text-secondary-label text-center px-4">{error}</p>
        : <p className="text-secondary-label">Loading...</p>}
    </div>
  );

  const hasDelays = data.delays.length > 0;

  return (
    <LayoutGroup>
    <div className="min-h-dvh lg:flex lg:flex-col lg:justify-center relative">
      <div
        className="fixed inset-0 bg-center bg-cover bg-no-repeat pointer-events-none opacity-[0.15] -z-10"
        style={{ backgroundImage: "url(/bg-doodles.png)" }}
      />

      {stale && (
        <div className="fixed top-0 inset-x-0 z-50 bg-danger/90 text-white text-center text-[13px] font-medium py-1.5 px-4 backdrop-blur-sm">
          Not receiving updates — check your connection
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-14 pb-8 lg:max-w-6xl lg:px-6 lg:py-6 lg:w-full lg:grid lg:grid-cols-[1fr_34rem] lg:gap-6">
        {/* Widget grid — single instance, CSS handles layout */}
        <WidgetGrid
          data={data}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          hasDelays={hasDelays}
        />

        {/* Schedule — desktop only, absolutely positioned inside grid cell
            so it doesn't influence the row height. Widget grid determines height. */}
        <div className="hidden lg:block relative">
          <motion.aside
            className="absolute inset-0"
            initial={{ opacity: 0, x: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <SchedulePanel events={data.schedule} delays={data.delays} />
          </motion.aside>
        </div>
      </div>

    </div>
    {/* Portal target for overlays — must be inside LayoutGroup for layoutId */}
    <div id="overlay-root" />
    </LayoutGroup>
  );
}
