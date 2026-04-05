import { useState } from "react";
import { LayoutGroup } from "framer-motion";
import { useLiveData } from "./data/useLiveData";
import { WidgetCard } from "./components/WidgetCard";
import { ScheduleCardCompact, ScheduleCardExpanded } from "./components/ScheduleCard";
import { AnnouncementsCardCompact, AnnouncementsCardExpanded } from "./components/AnnouncementsCard";
import { DelaysCardCompact, DelaysCardExpanded } from "./components/DelaysCard";
import { MapCardCompact, MapCardExpanded } from "./components/MapCard";
import { InfoCardCompact, InfoCardExpanded } from "./components/InfoCard";

function Header() {
  return (
    <header className="px-4 pt-5 pb-3 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-white tracking-tight">BmMT 2026</h1>
        <p className="text-xs text-muted">
          Sunday, April 12 &middot; UC Berkeley
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <span className="text-xs text-emerald-400 font-medium">LIVE</span>
      </div>
    </header>
  );
}

export default function App() {
  const { data } = useLiveData();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="min-h-dvh bg-surface max-w-lg mx-auto">
      <Header />

      <LayoutGroup>
        <main className="px-3 pb-6 grid grid-cols-2 gap-3 auto-rows-auto">
          {/* Schedule — large card, spans full width */}
          <WidgetCard
            id="schedule"
            title="Schedule"
            icon="📅"
            colSpan={2}
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            accentColor="var(--color-cal-california-gold)"
            expandedContent={
              <ScheduleCardExpanded events={data.schedule} delays={data.delays} />
            }
          >
            <ScheduleCardCompact events={data.schedule} delays={data.delays} />
          </WidgetCard>

          {/* Delays — urgent, prominent placement */}
          <WidgetCard
            id="delays"
            title="Delays"
            icon="⏱️"
            colSpan={data.delays.length > 0 ? 2 : 1}
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            accentColor={data.delays.length > 0 ? "var(--color-danger)" : undefined}
            expandedContent={<DelaysCardExpanded delays={data.delays} />}
          >
            <DelaysCardCompact delays={data.delays} />
          </WidgetCard>

          {/* Announcements */}
          <WidgetCard
            id="announcements"
            title="Announcements"
            icon="📢"
            colSpan={data.delays.length > 0 ? 2 : 1}
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            expandedContent={
              <AnnouncementsCardExpanded announcements={data.announcements} />
            }
          >
            <AnnouncementsCardCompact announcements={data.announcements} />
          </WidgetCard>

          {/* Map */}
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

          {/* Info */}
          <WidgetCard
            id="info"
            title="Info & Help"
            icon="ℹ️"
            expandedId={expandedId}
            onExpand={setExpandedId}
            onCollapse={() => setExpandedId(null)}
            expandedContent={<InfoCardExpanded info={data.info} />}
          >
            <InfoCardCompact info={data.info} />
          </WidgetCard>
        </main>
      </LayoutGroup>

      <footer className="px-4 pb-6 text-center">
        <p className="text-[10px] text-muted">
          Berkeley Math Tournament &middot; Student-run, not affiliated with UC Berkeley
        </p>
      </footer>
    </div>
  );
}
