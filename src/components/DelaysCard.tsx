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
      <div className="flex items-center gap-2.5 text-xs font-body">
        <span className="h-2 w-2 rounded-full bg-success shrink-0" />
        <span className="text-ink-light">All events on schedule</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {delays.map((d) => (
        <div key={d.id} className="flex items-center gap-2.5 rounded-xl bg-danger/5 px-3 py-2.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
          <span className="font-display font-600 text-ink truncate">{d.eventTitle}</span>
          <span className="ml-auto text-danger tabular-nums shrink-0 font-body font-500">
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
        <p className="font-display font-600 text-sm text-ink">All on schedule</p>
        <p className="text-xs text-ink-muted mt-1 font-body">Any delays will appear here in real time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {delays.map((d) => (
        <div key={d.id} className="rounded-xl bg-danger/5 ring-1 ring-danger/15 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
            <span className="font-display font-600 text-sm text-ink">{d.eventTitle}</span>
            <span className="ml-auto text-[10px] text-ink-muted font-body">{timeAgo(d.timestamp)}</span>
          </div>
          <div className="text-xs text-ink-light font-body space-y-1">
            <p className="tabular-nums">
              <span className="line-through text-danger">{formatTime(d.originalTime)}</span>
              <span className="mx-1.5 text-ink-muted">→</span>
              <span className="text-ink font-600">{formatTime(d.newTime)}</span>
            </p>
            {d.reason && <p className="text-ink-muted italic">{d.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
