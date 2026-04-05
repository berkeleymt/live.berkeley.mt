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
    <div className="-mx-4">
      {top.map((item, i) => (
        <div
          key={item.id}
          className={`flex items-center gap-3 px-4 py-2 text-[13px] ${
            i < top.length - 1 ? "border-b border-separator" : ""
          }`}
        >
          <span className="shrink-0 text-sm">{iconMap[item.label] ?? "ℹ️"}</span>
          <span className="text-secondary-label">{item.label}</span>
          <span className="ml-auto text-label font-medium truncate max-w-[120px] text-right">
            {item.value}
          </span>
        </div>
      ))}
      {info.length > 3 && (
        <p className="text-[11px] text-tertiary-label text-center py-2">
          +{info.length - 3} more
        </p>
      )}
    </div>
  );
}

export function InfoCardExpanded({ info }: InfoCardProps) {
  return (
    <div className="-mx-5 -my-4">
      {info.map((item, i) => (
        <div
          key={item.id}
          className={`px-5 py-3 flex items-start gap-3 ${
            i < info.length - 1 ? "border-b border-separator" : ""
          }`}
        >
          <span className="text-lg shrink-0">{iconMap[item.label] ?? "ℹ️"}</span>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-label">{item.label}</p>
            <p className="text-[13px] text-tertiary-label mt-0.5">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
