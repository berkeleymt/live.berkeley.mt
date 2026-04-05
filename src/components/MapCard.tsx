import type { VenueLocation } from "../data/types";

interface MapCardProps {
  venues: VenueLocation[];
}

export function MapCardCompact({ venues: _venues }: MapCardProps) {
  return (
    <div className="flex items-center justify-center h-full rounded-lg bg-bg -mx-4 -mb-3">
      <div className="text-center">
        <span className="text-3xl block mb-1">🗺️</span>
        <span className="text-[12px] text-tertiary-label">Tap for map</span>
      </div>
    </div>
  );
}

export function MapCardExpanded({ venues }: MapCardProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl aspect-[4/3] flex items-center justify-center bg-bg">
        <div className="text-center px-4">
          <span className="text-4xl block mb-3">🗺️</span>
          <p className="text-[13px] text-tertiary-label">
            Interactive campus map coming soon.
          </p>
          <a
            href="https://berkeley.edu/map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-[13px] font-medium text-link"
          >
            Open UC Berkeley map
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 9l6-6M5 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-tertiary-label uppercase tracking-wide mb-2 px-1">
          Key Locations
        </h3>
        <div className="-mx-5">
          {venues.map((v, i) => (
            <div
              key={v.id}
              className={`px-5 py-3 ${i < venues.length - 1 ? "border-b border-separator" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[15px] text-label font-medium">{v.name}</span>
                {v.floor && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-bg text-tertiary-label">
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
