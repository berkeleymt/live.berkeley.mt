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
    <div className="space-y-1.5">
      {top.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-xs">
          <span className="shrink-0">{iconMap[item.label] ?? "ℹ️"}</span>
          <span className="text-muted">{item.label}</span>
          <span className="ml-auto text-slate-300 truncate max-w-[140px] text-right">{item.value}</span>
        </div>
      ))}
      {info.length > 3 && (
        <p className="text-[10px] text-muted text-center pt-0.5">
          +{info.length - 3} more
        </p>
      )}
    </div>
  );
}

export function InfoCardExpanded({ info }: InfoCardProps) {
  return (
    <div className="space-y-2">
      {info.map((item) => (
        <div key={item.id} className="rounded-xl bg-white/5 p-3 flex items-start gap-3">
          <span className="text-lg shrink-0">{iconMap[item.label] ?? "ℹ️"}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{item.label}</p>
            <p className="text-xs text-muted mt-0.5">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
