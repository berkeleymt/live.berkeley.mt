import type { Announcement } from "../data/types";

interface AnnouncementsCardProps {
  announcements: Announcement[];
}

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
  const top = sorted.slice(0, 2);

  return (
    <div className="space-y-2">
      {top.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          {a.priority === "urgent" && (
            <span className="mt-0.5 flex h-2 w-2 shrink-0 rounded-full bg-danger" />
          )}
          {a.pinned && a.priority !== "urgent" && (
            <span className="mt-0.5 text-[10px] shrink-0">📌</span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium truncate ${a.priority === "urgent" ? "text-danger" : "text-heading"}`}>
              {a.title}
            </p>
            <p className="text-[10px] text-muted truncate">{a.body}</p>
          </div>
          <span className="text-[10px] text-muted shrink-0">{timeAgo(a.timestamp)}</span>
        </div>
      ))}
      {announcements.length > 2 && (
        <p className="text-[10px] text-muted text-center">
          +{announcements.length - 2} more
        </p>
      )}
    </div>
  );
}

export function AnnouncementsCardExpanded({ announcements }: AnnouncementsCardProps) {
  const sorted = [...announcements].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="space-y-3">
      {sorted.map((a) => (
        <div
          key={a.id}
          className={`rounded-xl p-3 ${
            a.priority === "urgent" ? "bg-red-50 ring-1 ring-danger/30" : "bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            {a.priority === "urgent" && <span className="h-2 w-2 rounded-full bg-danger shrink-0" />}
            {a.pinned && <span className="text-[10px]">📌</span>}
            <span className={`text-sm font-medium ${a.priority === "urgent" ? "text-danger" : "text-heading"}`}>
              {a.title}
            </span>
            <span className="ml-auto text-[10px] text-muted shrink-0">{timeAgo(a.timestamp)}</span>
          </div>
          <p className="text-xs text-body leading-relaxed">{a.body}</p>
        </div>
      ))}
    </div>
  );
}
