import type { DelayNotice } from "../data/types";

interface DelaysCardProps {
  delays: DelayNotice[];
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function timeAgo(timestamp: string) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function DelaysCardCompact({ delays }: DelaysCardProps) {
  if (delays.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <span className="h-2 w-2 rounded-full bg-success shrink-0" />
        <span className="text-secondary-label">All events on schedule</span>
      </div>
    );
  }

  return (
    <div className="-mx-4">
      {delays.map((d, i) => (
        <div
          key={d.id}
          className={`flex items-center gap-3 px-4 py-2.5 ${
            i < delays.length - 1 ? "border-b border-separator" : ""
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
          <span className="text-[13px] font-medium text-label truncate">{d.eventTitle}</span>
          <span className="ml-auto text-[13px] text-danger tabular-nums shrink-0 font-medium">
            {formatTime(d.originalTime)} → {formatTime(d.newTime)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DelaysCardExpanded({ delays }: DelaysCardProps) {
  if (delays.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
          <span className="text-success text-lg">✓</span>
        </div>
        <p className="text-[15px] font-medium text-label">All on schedule</p>
        <p className="text-[13px] text-tertiary-label mt-1">Any delays will appear here in real time.</p>
      </div>
    );
  }

  return (
    <div className="-mx-5 -my-4">
      {delays.map((d, i) => (
        <div
          key={d.id}
          className={`px-5 py-3.5 ${
            i < delays.length - 1 ? "border-b border-separator" : ""
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
            <span className="text-[15px] font-medium text-label">{d.eventTitle}</span>
            <span className="ml-auto text-[11px] text-tertiary-label">{timeAgo(d.timestamp)}</span>
          </div>
          <div className="text-[13px] text-secondary-label space-y-0.5">
            <p className="tabular-nums">
              <span className="line-through text-danger">{formatTime(d.originalTime)}</span>
              <span className="mx-1.5 text-tertiary-label">→</span>
              <span className="text-label font-medium">{formatTime(d.newTime)}</span>
            </p>
            {d.reason && <p className="text-tertiary-label">{d.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
