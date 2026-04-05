import { useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useLiveData } from "./data/useLiveData";
import { WidgetCard } from "./components/WidgetCard";
import { ScheduleCardCompact, ScheduleCardExpanded } from "./components/ScheduleCard";
import { AnnouncementsCardCompact, AnnouncementsCardExpanded } from "./components/AnnouncementsCard";
import { DelaysCardCompact, DelaysCardExpanded } from "./components/DelaysCard";
import { MapCardCompact, MapCardExpanded } from "./components/MapCard";
import { InfoCardCompact, InfoCardExpanded } from "./components/InfoCard";

const stagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.15 },
  },
};

const cardReveal = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 260, damping: 24 },
  },
};

function Header() {
  return (
    <header className="relative overflow-hidden bg-berkeley-blue text-white">
      {/* Geometric decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-10"
          style={{ background: "var(--color-california-gold)" }}
        />
        <div
          className="absolute -left-4 -bottom-12 w-24 h-24 rounded-full opacity-[0.07]"
          style={{ background: "var(--color-california-gold)" }}
        />
        {/* Diagonal line accent */}
        <div
          className="absolute top-0 right-16 w-px h-full opacity-10 origin-top"
          style={{ background: "var(--color-california-gold)", transform: "rotate(12deg)" }}
        />
      </div>

      <div className="relative px-5 pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <motion.h1
              className="font-display text-2xl font-800 tracking-tight leading-none"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              BmMT{" "}
              <span className="text-california-gold">2026</span>
            </motion.h1>
            <motion.p
              className="text-sm text-white/60 mt-1.5 font-body"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Sunday, April 12 &middot; UC Berkeley
            </motion.p>
          </div>

          <motion.div
            className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-california-gold opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-california-gold" />
            </span>
            <span className="text-xs font-display font-700 tracking-wider text-california-gold">
              LIVE
            </span>
          </motion.div>
        </div>
      </div>

      {/* Bottom edge — gold accent line */}
      <div className="h-[3px] bg-gradient-to-r from-california-gold via-california-gold/60 to-transparent" />
    </header>
  );
}

export default function App() {
  const { data } = useLiveData();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasDelays = data.delays.length > 0;

  return (
    <div className="min-h-dvh max-w-lg mx-auto">
      <Header />

      <LayoutGroup>
        <motion.main
          className="px-3 pt-4 pb-8 grid grid-cols-2 gap-3 auto-rows-auto"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {/* Schedule — large, full-width, most important */}
          <motion.div variants={cardReveal} className="col-span-2">
            <WidgetCard
              id="schedule"
              title="Schedule"
              icon="📅"
              expandedId={expandedId}
              onExpand={setExpandedId}
              onCollapse={() => setExpandedId(null)}
              accent="gold"
              expandedContent={
                <ScheduleCardExpanded events={data.schedule} delays={data.delays} />
              }
            >
              <ScheduleCardCompact events={data.schedule} delays={data.delays} />
            </WidgetCard>
          </motion.div>

          {/* Delays — urgent when active */}
          <motion.div variants={cardReveal} className={hasDelays ? "col-span-2" : ""}>
            <WidgetCard
              id="delays"
              title={hasDelays ? "Delays" : "Status"}
              icon={hasDelays ? "⚠️" : "✓"}
              expandedId={expandedId}
              onExpand={setExpandedId}
              onCollapse={() => setExpandedId(null)}
              accent={hasDelays ? "danger" : "success"}
              expandedContent={<DelaysCardExpanded delays={data.delays} />}
            >
              <DelaysCardCompact delays={data.delays} />
            </WidgetCard>
          </motion.div>

          {/* Announcements */}
          <motion.div variants={cardReveal} className={hasDelays ? "col-span-2" : ""}>
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

          {/* Map */}
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

          {/* Info */}
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
        </motion.main>
      </LayoutGroup>

      <footer className="px-5 pb-8 text-center">
        <div className="w-8 h-px bg-berkeley-blue/10 mx-auto mb-3" />
        <p className="text-[10px] text-ink-muted font-body tracking-wide">
          Berkeley Math Tournament &middot; Student-run
        </p>
      </footer>
    </div>
  );
}
