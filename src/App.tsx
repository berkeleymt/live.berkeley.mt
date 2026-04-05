import { useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useLiveData } from "./data/useLiveData";
import { WidgetCard } from "./components/WidgetCard";
import { staggerContainer, cardReveal } from "./components/springs";
import { ScheduleCardCompact, ScheduleCardExpanded } from "./components/ScheduleCard";
import { AnnouncementsCardCompact, AnnouncementsCardExpanded } from "./components/AnnouncementsCard";
import { DelaysCardCompact, DelaysCardExpanded } from "./components/DelaysCard";
import { MapCardCompact, MapCardExpanded } from "./components/MapCard";
import { InfoCardCompact, InfoCardExpanded } from "./components/InfoCard";

function Header() {
  return (
    <header className="bg-berkeley-blue text-white">
      <div className="px-5 pt-14 pb-4">
        <div className="flex items-end justify-between">
          <div>
            <motion.p
              className="text-xs text-white/50 font-medium tracking-wide uppercase mb-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              Sunday, April 12
            </motion.p>
            <motion.h1
              className="text-[28px] font-bold tracking-tight leading-none"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              BmMT 2026
            </motion.h1>
          </div>

          <motion.div
            className="flex items-center gap-1.5 bg-white/10 rounded-full px-2.5 py-1"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
            </span>
            <span className="text-[11px] font-semibold text-white/90">
              Live
            </span>
          </motion.div>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const { data } = useLiveData();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasDelays = data.delays.length > 0;

  return (
    <LayoutGroup>
    <div className="min-h-dvh max-w-lg mx-auto">
      <Header />

      <motion.main
        className="px-4 pt-4 pb-8 space-y-3"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {/* Delays — prominent when active */}
        {hasDelays && (
          <motion.div variants={cardReveal}>
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

        {/* Schedule */}
        <motion.div variants={cardReveal}>
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

        {/* Announcements */}
        <motion.div variants={cardReveal}>
          <WidgetCard
            id="announcements"
            title="Announcements"
            icon="📣"
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            expandedContent={
              <AnnouncementsCardExpanded announcements={data.announcements} />
            }
          >
            <AnnouncementsCardCompact announcements={data.announcements} />
          </WidgetCard>
        </motion.div>

        {/* Two-column row: Map + Info */}
        <div className="grid grid-cols-2 gap-3">
          <motion.div variants={cardReveal}>
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

          <motion.div variants={cardReveal}>
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
        </div>

        {/* Status — when no delays, small inline indicator */}
        {!hasDelays && (
          <motion.div variants={cardReveal}>
            <WidgetCard
              id="delays"
              title="Status"
              icon="✓"
              expandedId={expandedId}
              onExpand={setExpandedId}
              onCollapse={() => setExpandedId(null)}
              expandedContent={<DelaysCardExpanded delays={data.delays} />}
            >
              <DelaysCardCompact delays={data.delays} />
            </WidgetCard>
          </motion.div>
        )}
      </motion.main>

      <footer className="px-5 pb-8 text-center">
        <p className="text-[11px] text-tertiary-label">
          Berkeley Math Tournament
        </p>
      </footer>
    </div>
    </LayoutGroup>
  );
}
