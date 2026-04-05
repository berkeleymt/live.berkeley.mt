import type { VenueLocation } from "../data/types";

interface MapCardProps {
  venues: VenueLocation[];
}

export function MapCardCompact({ venues: _venues }: MapCardProps) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-slate-50 h-24 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <span className="text-2xl block mb-1">🗺️</span>
          <span className="text-[10px] text-muted">Tap to view campus map</span>
        </div>
      </div>
    </div>
  );
}

export function MapCardExpanded({ venues }: MapCardProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 aspect-[4/3] flex items-center justify-center">
        <div className="text-center px-4">
          <span className="text-4xl block mb-2">🗺️</span>
          <p className="text-xs text-muted">
            Interactive campus map coming soon.
          </p>
          <a
            href="https://berkeley.edu/map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-xs text-cal-founders-rock font-medium underline underline-offset-2"
          >
            Open UC Berkeley map →
          </a>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-heading mb-2">Key Locations</h3>
        <div className="space-y-2">
          {venues.map((v) => (
            <div key={v.id} className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-heading">{v.name}</span>
                {v.floor && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-muted">
                    {v.floor}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted leading-relaxed">{v.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
