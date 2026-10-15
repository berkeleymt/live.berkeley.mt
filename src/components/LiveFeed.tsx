import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Announcement } from "../data/types";

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mt-1 first:mt-0">{children}</p>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline">
      {children}
    </a>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mt-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mt-1.5 space-y-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mt-2 overflow-x-auto -mx-1">
      <table className="text-[13px] w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="border-b border-separator">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="text-left font-semibold text-label px-1.5 py-1">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="text-secondary-label px-1.5 py-1">{children}</td>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b border-separator/50 last:border-0">{children}</tr>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="bg-fill/50 px-1 py-0.5 rounded text-[13px]">{children}</code>,
};

function useTimeAgo(timestamp: string, devNow?: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (devNow != null) return; // Don't auto-tick in dev mode
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [devNow]);

  const diff = (devNow ?? now) - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function FeedItem({ announcement, devNow, isLatest }: { announcement: Announcement; devNow?: number | null; isLatest?: boolean }) {
  const timeAgo = useTimeAgo(announcement.timestamp, devNow);
  const isUrgent = announcement.priority === "urgent";

  if (isLatest) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -12, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ type: "spring", duration: 0.5, bounce: 0 }}
        className={`px-4 pt-5 pb-4 ${isUrgent ? "bg-danger/5" : "bg-california-gold/[0.04]"}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-california-gold">Latest</span>
          <span className="text-[11px] text-tertiary-label tabular-nums">{timeAgo}</span>
        </div>
        <p className={`text-[20px] font-bold leading-snug tracking-tight ${
          isUrgent ? "text-danger" : "text-label"
        }`}>
          {announcement.title}
        </p>
        <div className="text-[14px] text-secondary-label leading-relaxed mt-1.5">
          <Markdown components={mdComponents} remarkPlugins={[remarkGfm]} skipHtml>{announcement.body}</Markdown>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ type: "spring", duration: 0.5, bounce: 0 }}
      className={`px-4 py-3.5 ${isUrgent ? "bg-danger/5" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
          isUrgent ? "bg-danger" : "bg-tertiary-label/40"
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={`text-[14px] font-semibold leading-tight ${
              isUrgent ? "text-danger" : "text-label"
            }`}>
              {announcement.title}
            </span>
            <span className="text-[11px] text-tertiary-label tabular-nums shrink-0">
              {timeAgo}
            </span>
          </div>
          <div className="text-[13px] text-secondary-label leading-relaxed mt-1">
            <Markdown components={mdComponents} remarkPlugins={[remarkGfm]} skipHtml>{announcement.body}</Markdown>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function LiveFeed({ announcements, devNow }: { announcements: Announcement[]; devNow?: number | null }) {
  const sorted = [...announcements].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const [previous, setPrevious] = useState(announcements);
  const [newIds, setNewIds] = useState(new Set<string>());

  if (announcements !== previous) {
    setPrevious(announcements);
    const previousIds = new Set(previous.map((a) => a.id));
    const fresh = new Set(announcements.filter((a) => !previousIds.has(a.id)).map((a) => a.id));
    if (previous.length > 0 && fresh.size > 0) setNewIds(fresh);
  }

  useEffect(() => {
    if (newIds.size === 0) return;
    const timer = setTimeout(() => setNewIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [newIds]);

  return (
    <div className="flex flex-col h-full">
      {/* Feed header */}
      <div className="px-4 py-3 border-b border-black/[0.06] shrink-0 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
        </span>
        <span className="text-[13px] font-semibold text-tertiary-label uppercase tracking-wider">Live Updates</span>
        <span className="text-[12px] text-tertiary-label ml-auto tabular-nums">
          {sorted.length} {sorted.length === 1 ? "update" : "updates"}
        </span>
      </div>

      {/* Feed items */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
            <span className="relative flex h-3 w-3 mb-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/50 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success/50" />
            </span>
            <p className="text-[14px] text-tertiary-label">Listening for updates...</p>
            <p className="text-[12px] text-quaternary-label mt-1">
              Announcements will appear here in real time
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sorted.map((a, i) => (
              <div
                key={a.id}
                className={`border-b border-black/[0.04] last:border-b-0 ${
                  newIds.has(a.id) ? "bg-california-gold/10" : ""
                } transition-colors duration-[3000ms]`}
              >
                <FeedItem announcement={a} devNow={devNow} isLatest={i === 0} />
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
