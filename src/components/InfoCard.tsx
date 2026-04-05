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
  const tiles = info.slice(0, 4);
  return (
    <div className="h-full p-4 flex flex-col">
      <p className="text-[13px] font-bold text-secondary-label uppercase tracking-wide px-0.5 mb-3">
        Info & Help
      </p>
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2">
        {tiles.map((item) => (
          <div
            key={item.id}
            className="flex flex-col items-center justify-center rounded-xl bg-bg/80"
          >
            <span className="text-[28px] leading-none">{iconMap[item.label] ?? "ℹ️"}</span>
            <p className="text-[11px] font-semibold text-secondary-label leading-tight mt-1.5 text-center px-1">
              {item.label}
            </p>
          </div>
        ))}
      </div>
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
            i < info.length - 1 ? "border-b border-white/20" : ""
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
