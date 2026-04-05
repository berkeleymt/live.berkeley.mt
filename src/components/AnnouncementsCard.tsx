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
    <div className="-mx-4">
      {top.map((a, i) => (
        <div
          key={a.id}
          className={`flex items-start gap-3 px-4 py-2.5 ${
            i < top.length - 1 ? "border-b border-separator" : ""
          }`}
        >
          {a.priority === "urgent" && (
            <span className="mt-1.5 flex h-2 w-2 shrink-0 rounded-full bg-danger" />
          )}
          {a.pinned && a.priority !== "urgent" && (
            <span className="mt-0.5 text-[11px] shrink-0">📌</span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-[13px] font-medium truncate ${a.priority === "urgent" ? "text-danger" : "text-label"}`}>
              {a.title}
            </p>
            <p className="text-[12px] text-tertiary-label truncate mt-0.5">{a.body}</p>
          </div>
          <span className="text-[11px] text-tertiary-label shrink-0 tabular-nums mt-0.5">
            {timeAgo(a.timestamp)}
          </span>
        </div>
      ))}
      {announcements.length > 2 && (
        <p className="text-[11px] text-tertiary-label text-center py-2">
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
    <div className="-mx-5 -my-4">
      {sorted.map((a, i) => (
        <div
          key={a.id}
          className={`px-5 py-3.5 ${
            i < sorted.length - 1 ? "border-b border-separator" : ""
          } ${a.priority === "urgent" ? "bg-danger/5" : ""}`}
        >
          <div className="flex items-center gap-2 mb-1">
            {a.priority === "urgent" && <span className="h-2 w-2 rounded-full bg-danger shrink-0" />}
            {a.pinned && a.priority !== "urgent" && <span className="text-[11px]">📌</span>}
            <span className={`text-[15px] font-medium ${a.priority === "urgent" ? "text-danger" : "text-label"}`}>
              {a.title}
            </span>
            <span className="ml-auto text-[11px] text-tertiary-label tabular-nums shrink-0">
              {timeAgo(a.timestamp)}
            </span>
          </div>
          <p className="text-[13px] text-secondary-label leading-relaxed">{a.body}</p>
        </div>
      ))}
    </div>
  );
}
