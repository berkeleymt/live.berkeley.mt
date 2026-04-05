import type { InfoItem } from "../data/types";

interface InfoCardProps {
  info: InfoItem[];
}

const iconMap: Record<string, string> = {
  "Wi-Fi": "📶",
  Emergency: "🚨",
  "Lost & Found": "📦",
  Restrooms: "🚻",
  Disputes: "📋",
  "Contact Staff": "💬",
  "Campus Map": "🗺️",
  Parking: "🅿️",
};

export function InfoCardCompact({ info }: InfoCardProps) {
  const top = info.slice(0, 3);
  return (
    <div className="space-y-2">
      {top.map((item) => (
        <div key={item.id} className="flex items-center gap-2.5 text-xs">
          <span className="shrink-0 text-sm">{iconMap[item.label] ?? "ℹ️"}</span>
          <span className="text-ink-muted font-body">{item.label}</span>
          <span className="ml-auto text-ink-light font-body font-500 truncate max-w-[130px] text-right">
            {item.value}
          </span>
        </div>
      ))}
      {info.length > 3 && (
        <p className="text-[10px] text-ink-muted text-center pt-0.5 font-body tracking-wide">
          +{info.length - 3} MORE
        </p>
      )}
    </div>
  );
}

export function InfoCardExpanded({ info }: InfoCardProps) {
  return (
    <div className="space-y-2">
      {info.map((item) => (
        <div key={item.id} className="rounded-xl bg-surface/60 p-3.5 flex items-start gap-3">
          <span className="text-lg shrink-0">{iconMap[item.label] ?? "ℹ️"}</span>
          <div className="min-w-0">
            <p className="font-display font-600 text-sm text-ink">{item.label}</p>
            <p className="text-xs text-ink-muted mt-0.5 font-body">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
