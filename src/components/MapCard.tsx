import type { VenueLocation } from "../data/types";

interface MapCardProps {
  venues: VenueLocation[];
}

export function MapCardCompact({ venues: _venues }: MapCardProps) {
  return (
    <div
      className="rounded-xl h-24 flex items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(0,50,98,0.04), rgba(59,126,161,0.06))",
      }}
    >
      <div className="text-center">
        <span className="text-2xl block mb-1">🗺️</span>
        <span className="text-[10px] text-ink-muted font-body tracking-wide">TAP FOR MAP</span>
      </div>
    </div>
  );
}

export function MapCardExpanded({ venues }: MapCardProps) {
  return (
    <div className="space-y-5">
      <div
        className="rounded-xl aspect-[4/3] flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, rgba(0,50,98,0.04), rgba(59,126,161,0.08))",
        }}
      >
        <div className="text-center px-4">
          <span className="text-4xl block mb-3">🗺️</span>
          <p className="text-xs text-ink-muted font-body">
            Interactive campus map coming soon.
          </p>
          <a
            href="https://berkeley.edu/map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs font-display font-600
              text-founders-rock hover:text-berkeley-blue transition-colors"
          >
            Open UC Berkeley map
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 9l6-6M5 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <div>
        <h3 className="font-display font-700 text-xs text-ink tracking-tight mb-3">
          KEY LOCATIONS
        </h3>
        <div className="space-y-2">
          {venues.map((v) => (
            <div key={v.id} className="rounded-xl bg-surface/60 p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-display font-600 text-sm text-ink">{v.name}</span>
                {v.floor && (
                  <span className="text-[10px] font-600 px-2 py-0.5 rounded-full bg-berkeley-blue/8 text-berkeley-blue">
                    {v.floor}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted leading-relaxed font-body">{v.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
