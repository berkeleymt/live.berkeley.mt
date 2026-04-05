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
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-slate-300">All events on schedule</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {delays.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded-lg bg-danger/10 px-2.5 py-2 text-xs">
          <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
          <span className="text-white font-medium truncate">{d.eventTitle}</span>
          <span className="ml-auto text-danger tabular-nums shrink-0">
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
      <div className="text-center py-6">
        <span className="text-3xl mb-2 block">✅</span>
        <p className="text-sm text-slate-300">All events are running on schedule.</p>
        <p className="text-xs text-muted mt-1">Any delays will appear here in real time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {delays.map((d) => (
        <div key={d.id} className="rounded-xl bg-danger/10 ring-1 ring-danger/30 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
            <span className="text-sm font-medium text-white">{d.eventTitle}</span>
            <span className="ml-auto text-[10px] text-muted">{timeAgo(d.timestamp)}</span>
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <p className="tabular-nums">
              <span className="line-through text-danger">{formatTime(d.originalTime)}</span>
              {" → "}
              <span className="text-white font-medium">{formatTime(d.newTime)}</span>
            </p>
            {d.reason && <p className="text-muted">{d.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
