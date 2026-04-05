import type { VenueLocation } from "../data/types";

interface MapCardProps {
  venues: VenueLocation[];
}

const MAP_TILE_URL = "https://tile.openstreetmap.org/15/5254/12648.png";

export function MapCardCompact({ venues }: MapCardProps) {
  return (
    <div className="h-full relative">
      {/* Map background */}
      <img
        src={MAP_TILE_URL}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[20px] leading-none">📍</span>
          <p className="text-[18px] font-bold text-white tracking-tight">
            Map
          </p>
        </div>
        <p className="text-[13px] text-white/70 leading-tight mt-0.5">
          {venues.length} locations
        </p>
      </div>
    </div>
  );
}

export function MapCardExpanded({ venues }: MapCardProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden aspect-[4/3] relative">
        <iframe
          title="UC Berkeley Campus Map"
          src="https://www.openstreetmap.org/export/embed.html?bbox=-122.265,37.868,-122.252,37.876&layer=mapnik"
          className="w-full h-full border-0"
        />
      </div>

      <a
        href="https://www.openstreetmap.org/#map=16/37.872/-122.258"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-link"
      >
        Open full map
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 9l6-6M5 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>

      <div>
        <h3 className="text-[13px] font-semibold text-tertiary-label uppercase tracking-wide mb-2 px-1">
          Key Locations
        </h3>
        <div className="-mx-5">
          {venues.map((v, i) => (
            <div
              key={v.id}
              className={`px-5 py-3 ${i < venues.length - 1 ? "border-b border-white/20" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[15px] text-label font-medium">{v.name}</span>
                {v.floor && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/5 text-tertiary-label">
                    {v.floor}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-tertiary-label mt-0.5">{v.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
