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
  const first = delays[0];
  if (!first) return null;

  return (
    <div className="h-full p-5 flex gap-4 bg-gradient-to-br from-danger/10 to-danger/5">
      {/* Left: icon */}
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <span className="text-[32px] leading-none">⚠️</span>
        {delays.length > 1 && (
          <span className="text-[12px] font-bold text-white bg-danger rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
            {delays.length}
          </span>
        )}
      </div>

      {/* Right: content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-[12px] font-bold text-danger uppercase tracking-wide mb-1">
          {delays.length === 1 ? "Delay" : `${delays.length} Delays`}
        </p>
        <p className="text-[20px] font-bold text-label leading-tight tracking-tight">
          {first.eventTitle}
        </p>
        <p className="text-[17px] tabular-nums font-semibold mt-1.5">
          <span className="text-danger line-through">{formatTime(first.originalTime)}</span>
          <span className="text-tertiary-label mx-1.5 text-[13px]">now</span>
          <span className="text-label">{formatTime(first.newTime)}</span>
        </p>
        {first.reason && (
          <p className="text-[13px] text-tertiary-label mt-1 line-clamp-1">
            {first.reason}
          </p>
        )}
      </div>
    </div>
  );
}

function groupByEvent(delays: DelayNotice[]) {
  const groups: { eventId: string; eventTitle: string; delays: DelayNotice[] }[] = [];
  const idx = new Map<string, number>();
  for (const d of delays) {
    const i = idx.get(d.eventId);
    if (i !== undefined) {
      groups[i].delays.push(d);
    } else {
      idx.set(d.eventId, groups.length);
      groups.push({ eventId: d.eventId, eventTitle: d.eventTitle, delays: [d] });
    }
  }
  return groups;
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

  const groups = groupByEvent(delays);

  return (
    <div className="-mx-5 -my-4">
      {groups.map((g, gi) => (
        <div
          key={g.eventId}
          className={`px-5 py-3.5 ${
            gi < groups.length - 1 ? "border-b border-black/[0.06]" : ""
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
            <span className="text-[15px] font-medium text-label">{g.eventTitle}</span>
            <span className="ml-auto text-[11px] text-tertiary-label">
              {timeAgo(g.delays[0].timestamp)}
            </span>
          </div>
          <div className="text-[13px] text-secondary-label space-y-0.5">
            {g.delays.map((d) => (
              <div key={d.id}>
                <p className="tabular-nums">
                  <span className="line-through text-danger">{formatTime(d.originalTime)}</span>
                  <span className="mx-1.5 text-tertiary-label">→</span>
                  <span className="text-label font-medium">{formatTime(d.newTime)}</span>
                </p>
                {d.reason && <p className="text-tertiary-label">{d.reason}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatusCardCompact() {
  return (
    <div className="h-full p-4 flex flex-col items-center justify-center bg-gradient-to-br from-success/8 to-success/3">
      <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-success">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-[18px] font-bold text-label mt-3 tracking-tight">On Schedule</p>
      <p className="text-[12px] text-tertiary-label leading-tight text-center mt-0.5">Everything on time</p>
    </div>
  );
}
