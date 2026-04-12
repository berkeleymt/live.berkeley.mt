import type { Announcement } from "../data/types";
import Markdown from "react-markdown";

interface AnnouncementsCardProps {
  announcements: Announcement[];
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline">
      {children}
    </a>
  ),
};

function timeAgo(timestamp: string) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function AnnouncementsCardCompact({ announcements }: AnnouncementsCardProps) {
  const sorted = [...announcements].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const latest = sorted[0];
  const hasUrgent = sorted.some((a) => a.priority === "urgent");

  if (!latest) {
    return (
      <div className="h-full p-5 flex items-center justify-center text-[15px] text-tertiary-label">
        No announcements yet
      </div>
    );
  }

  return (
    <div className="h-full p-5 flex gap-4 overflow-hidden">
      {/* Left: icon + count */}
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <span className="text-[32px] leading-none">{hasUrgent ? "🚨" : "📣"}</span>
        {announcements.length > 1 && (
          <span className="text-[12px] font-bold text-white bg-label rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
            {announcements.length}
          </span>
        )}
      </div>

      {/* Right: content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-[12px] font-bold text-tertiary-label uppercase tracking-wide mb-1">
          {latest.priority === "urgent" ? "Urgent" : "Latest"}
        </p>
        <p className={`text-[20px] font-bold leading-tight tracking-tight line-clamp-2 text-balance ${
          latest.priority === "urgent" ? "text-danger" : "text-label"
        }`}>
          {latest.title}
        </p>
        <p className="text-[14px] text-secondary-label mt-1.5 line-clamp-2 leading-snug flex-1">
          <Markdown components={mdComponents} skipHtml>{latest.body}</Markdown>
        </p>
        <p className="text-[12px] text-tertiary-label tabular-nums mt-1">
          {timeAgo(latest.timestamp)}
        </p>
      </div>
    </div>
  );
}

export function AnnouncementsCardExpanded({ announcements }: AnnouncementsCardProps) {
  const sorted = [...announcements].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((a) => (
        <div
          key={a.id}
          className="glass-heavy widget-shadow-lg px-5 py-4"
        >
          <div className="flex items-start gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {a.priority === "urgent" && (
                <span className="h-2 w-2 rounded-full bg-danger shrink-0 mt-1" />
              )}
              {a.pinned && a.priority !== "urgent" && (
                <span className="text-[11px] shrink-0">📌</span>
              )}
              <span className={`text-[15px] font-semibold ${
                a.priority === "urgent" ? "text-danger" : "text-label"
              }`}>
                {a.title}
              </span>
            </div>
            <span className="text-[11px] text-tertiary-label tabular-nums shrink-0 mt-0.5">
              {timeAgo(a.timestamp)}
            </span>
          </div>
          <div className="text-[14px] text-secondary-label leading-relaxed">
            <Markdown components={mdComponents} skipHtml>{a.body}</Markdown>
          </div>
        </div>
      ))}
    </div>
  );
}
