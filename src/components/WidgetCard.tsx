import { useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface WidgetCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  expandedContent?: ReactNode;
  colSpan?: 1 | 2;
  rowSpan?: 1 | 2;
  accentColor?: string;
  expandedId: string | null;
  id: string;
  onExpand: (id: string) => void;
  onCollapse: () => void;
}

export function WidgetCard({
  title,
  icon,
  children,
  expandedContent,
  colSpan = 1,
  rowSpan = 1,
  accentColor,
  expandedId,
  id,
  onExpand,
  onCollapse,
}: WidgetCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isExpanded = expandedId === id;
  const isExpandable = !!expandedContent;

  const spanClass =
    colSpan === 2 && rowSpan === 2
      ? "col-span-2 row-span-2"
      : colSpan === 2
        ? "col-span-2"
        : rowSpan === 2
          ? "row-span-2"
          : "";

  return (
    <>
      <motion.div
        ref={cardRef}
        layoutId={`card-${id}`}
        className={`
          relative rounded-2xl border border-card-border bg-card-bg
          overflow-hidden ${spanClass}
          ${isExpandable ? "cursor-pointer active:scale-[0.98]" : ""}
          transition-[filter] duration-200
        `}
        style={{
          borderTop: accentColor ? `2px solid ${accentColor}` : undefined,
        }}
        onClick={() => {
          if (isExpandable && !isExpanded) onExpand(id);
        }}
        whileHover={isExpandable ? { backgroundColor: "oklch(0.26 0.01 260)" } : undefined}
      >
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg shrink-0">{icon}</span>
            <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
            {isExpandable && (
              <span className="ml-auto text-muted text-xs">Tap to expand</span>
            )}
          </div>
          {children}
        </div>
      </motion.div>

      <AnimatePresence>
        {isExpanded && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCollapse}
            />
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={onCollapse}
            >
              <motion.div
                layoutId={`card-${id}`}
                className="relative rounded-2xl border border-card-border bg-card-bg
                  overflow-hidden w-full max-w-lg max-h-[85vh] flex flex-col"
                style={{
                  borderTop: accentColor ? `2px solid ${accentColor}` : undefined,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-5 border-b border-card-border flex items-center gap-2 shrink-0">
                  <span className="text-lg">{icon}</span>
                  <h2 className="text-base font-semibold text-white flex-1">{title}</h2>
                  <button
                    onClick={onCollapse}
                    className="text-muted hover:text-white transition-colors p-1 -mr-1"
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
