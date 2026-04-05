/**
 * Faint decorative SVG illustrations for the desktop background.
 * Berkeley landmarks + math symbols, rendered at very low opacity.
 */

function Campanile({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 260"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Spire */}
      <line x1="40" y1="0" x2="40" y2="30" />
      {/* Top cap */}
      <rect x="30" y="30" width="20" height="8" rx="1" />
      {/* Upper shaft */}
      <rect x="28" y="38" width="24" height="20" rx="1" />
      {/* Clock face */}
      <rect x="25" y="58" width="30" height="30" rx="2" />
      <circle cx="40" cy="73" r="10" />
      <line x1="40" y1="73" x2="40" y2="66" />
      <line x1="40" y1="73" x2="46" y2="73" />
      {/* Observation deck */}
      <rect x="22" y="88" width="36" height="6" rx="1" />
      {/* Main tower */}
      <rect x="26" y="94" width="28" height="120" rx="1" />
      {/* Windows */}
      {[110, 130, 150, 170, 190].map((y) => (
        <g key={y}>
          <rect x="32" y={y} width="6" height="10" rx="0.5" />
          <rect x="42" y={y} width="6" height="10" rx="0.5" />
        </g>
      ))}
      {/* Base */}
      <rect x="20" y="214" width="40" height="10" rx="1" />
      <rect x="16" y="224" width="48" height="8" rx="1" />
      {/* Steps */}
      <rect x="12" y="232" width="56" height="6" rx="1" />
      <rect x="8" y="238" width="64" height="6" rx="1" />
      <line x1="8" y1="244" x2="72" y2="244" />
    </svg>
  );
}

function MathSymbols({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Pi symbol */}
      <g transform="translate(10, 20)">
        <line x1="5" y1="0" x2="45" y2="0" />
        <line x1="15" y1="0" x2="13" y2="40" />
        <line x1="35" y1="0" x2="37" y2="35" />
        <path d="M37 35 Q39 42 35 44" />
      </g>

      {/* Sigma (summation) */}
      <g transform="translate(80, 10)">
        <polyline points="35,0 5,0 20,22 5,44 35,44" />
      </g>

      {/* Integral */}
      <g transform="translate(145, 10)">
        <path d="M20 0 Q10 0 10 10 L10 35 Q10 48 5 48" />
        <circle cx="22" cy="2" r="1.5" fill="currentColor" />
        <circle cx="3" cy="48" r="1.5" fill="currentColor" />
      </g>

      {/* Square root */}
      <g transform="translate(10, 90)">
        <polyline points="0,20 8,20 16,40 40,0 55,0" />
      </g>

      {/* Infinity */}
      <g transform="translate(80, 100)">
        <path d="M20 15 Q20 0 30 0 Q45 0 45 15 Q45 30 30 30 Q20 30 20 15 Q20 0 10 0 Q0 0 0 15 Q0 30 10 30 Q20 30 20 15" />
      </g>

      {/* Triangle (geometry) */}
      <g transform="translate(145, 85)">
        <polygon points="20,0 0,40 40,40" />
      </g>

      {/* Partial derivative ∂ */}
      <g transform="translate(30, 155)">
        <path d="M18 5 Q5 0 5 15 Q5 30 15 30 Q25 30 25 18 Q25 6 15 6 Q10 6 8 10" />
      </g>

      {/* Plus/equals */}
      <g transform="translate(110, 160)">
        <line x1="0" y1="10" x2="20" y2="10" />
        <line x1="10" y1="0" x2="10" y2="20" />
        <line x1="30" y1="7" x2="50" y2="7" />
        <line x1="30" y1="13" x2="50" y2="13" />
      </g>
    </svg>
  );
}

function GoldenRatio({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Golden spiral approximation */}
      <rect x="0" y="0" width="100" height="100" rx="2" />
      <rect x="0" y="0" width="62" height="62" rx="2" />
      <rect x="0" y="62" width="38" height="38" rx="1" />
      <rect x="38" y="62" width="24" height="24" rx="1" />
      <rect x="38" y="86" width="14" height="14" rx="1" />
      {/* Spiral curve */}
      <path d="M100 0 Q100 100 0 100 Q0 62 38 62 Q62 62 62 86 Q62 100 52 100 Q38 100 38 90" />
    </svg>
  );
}

function Bear({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Ears */}
      <circle cx="30" cy="25" r="16" />
      <circle cx="90" cy="25" r="16" />
      <circle cx="30" cy="25" r="8" />
      <circle cx="90" cy="25" r="8" />
      {/* Head */}
      <ellipse cx="60" cy="60" rx="40" ry="38" />
      {/* Eyes */}
      <circle cx="45" cy="52" r="4" fill="currentColor" />
      <circle cx="75" cy="52" r="4" fill="currentColor" />
      {/* Snout */}
      <ellipse cx="60" cy="70" rx="14" ry="10" />
      <circle cx="60" cy="66" r="3" fill="currentColor" />
      {/* Mouth */}
      <path d="M55 72 Q60 78 65 72" />
    </svg>
  );
}

export function BackgroundDecor() {
  return (
    <div
      className="hidden lg:block pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <Campanile className="absolute text-berkeley-blue/[0.04] w-20 right-[12%] top-[15%]" />
      <MathSymbols className="absolute text-berkeley-blue/[0.05] w-44 right-[30%] top-[30%]" />
      <GoldenRatio className="absolute text-berkeley-blue/[0.04] w-36 right-[8%] bottom-[25%]" />
      <Bear className="absolute text-berkeley-blue/[0.04] w-24 right-[45%] bottom-[10%]" />
    </div>
  );
}
