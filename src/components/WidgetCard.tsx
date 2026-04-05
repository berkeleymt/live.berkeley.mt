import { useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

const layoutTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

type AccentStyle = "gold" | "danger" | "success" | "blue" | undefined;

interface WidgetCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  expandedContent?: ReactNode;
  accent?: AccentStyle;
  expandedId: string | null;
  id: string;
  onExpand: (id: string) => void;
  onCollapse: () => void;
}

const accentStyles: Record<string, { border: string; bg: string }> = {
  gold: { border: "var(--color-california-gold)", bg: "rgba(253, 181, 21, 0.06)" },
  danger: { border: "var(--color-danger)", bg: "rgba(197, 48, 48, 0.04)" },
  success: { border: "var(--color-success)", bg: "rgba(39, 103, 73, 0.04)" },
  blue: { border: "var(--color-berkeley-blue)", bg: "rgba(0, 50, 98, 0.03)" },
};

export function WidgetCard({
  title,
  icon,
  children,
  expandedContent,
  accent,
  expandedId,
  id,
  onExpand,
  onCollapse,
}: WidgetCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isExpanded = expandedId === id;
  const isExpandable = !!expandedContent;
  const accentStyle = accent ? accentStyles[accent] : undefined;

  return (
    <>
      <motion.div
        ref={cardRef}
        layoutId={`card-${id}`}
        transition={{ layout: layoutTransition }}
        className={`
          relative rounded-2xl bg-card overflow-hidden h-full
          shadow-[0_1px_3px_rgba(0,50,98,0.06),0_1px_2px_rgba(0,50,98,0.04)]
          ${isExpandable ? "cursor-pointer active:scale-[0.98]" : ""}
          transition-all duration-200
          hover:shadow-[0_4px_12px_rgba(0,50,98,0.08),0_2px_4px_rgba(0,50,98,0.04)]
        `}
        style={{
          borderLeft: accentStyle ? `3px solid ${accentStyle.border}` : "1px solid var(--color-card-border)",
          borderRight: "1px solid var(--color-card-border)",
          borderTop: "1px solid var(--color-card-border)",
          borderBottom: "1px solid var(--color-card-border)",
          background: accentStyle ? `linear-gradient(135deg, ${accentStyle.bg}, var(--color-card))` : undefined,
        }}
        onClick={() => {
          if (isExpandable && !isExpanded) onExpand(id);
        }}
      >
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-base shrink-0">{icon}</span>
            <h2 className="font-display text-sm font-700 text-ink tracking-tight truncate">
              {title}
            </h2>
            {isExpandable && (
              <svg
                className="ml-auto shrink-0 text-ink-muted"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M6 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          {children}
        </div>
      </motion.div>

      <AnimatePresence>
        {isExpanded && (
          <>
            <motion.div
              className="fixed inset-0 bg-berkeley-blue/20 backdrop-blur-sm z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onCollapse}
            />
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={onCollapse}
            >
              <motion.div
                layoutId={`card-${id}`}
                transition={{ layout: layoutTransition }}
                className="relative rounded-2xl bg-card overflow-hidden
                  w-full max-w-lg max-h-[85vh] flex flex-col
                  shadow-[0_25px_50px_rgba(0,50,98,0.15),0_10px_20px_rgba(0,50,98,0.1)]"
                style={{
                  borderLeft: accentStyle ? `3px solid ${accentStyle.border}` : "1px solid var(--color-card-border)",
                  borderRight: "1px solid var(--color-card-border)",
                  borderTop: "1px solid var(--color-card-border)",
                  borderBottom: "1px solid var(--color-card-border)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-card-border flex items-center gap-2.5 shrink-0">
                  <span className="text-base">{icon}</span>
                  <h2 className="font-display text-base font-700 text-ink tracking-tight flex-1">
                    {title}
                  </h2>
                  <button
                    onClick={onCollapse}
                    className="text-ink-muted hover:text-ink transition-colors p-1.5 -mr-1.5
                      rounded-full hover:bg-berkeley-blue/5"
                    aria-label="Close"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="p-5 overflow-y-auto overscroll-contain">
                  {expandedContent}
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
