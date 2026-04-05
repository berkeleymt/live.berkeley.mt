import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTilt } from "../hooks/useTilt";
import { ExpandableOverlay } from "./ExpandableOverlay";
import { cardSpring } from "./springs";

interface WidgetCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  expandedContent?: ReactNode;
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
  expandedId,
  id,
  onExpand,
  onCollapse,
}: WidgetCardProps) {
  const isExpanded = expandedId === id;
  const isExpandable = !!expandedContent;
  const layoutId = `card-${id}`;

  const tilt = useTilt(isExpandable);

  return (
    <>
      <div style={{ perspective: 800 }}>
        <motion.div
          layoutId={layoutId}
          transition={cardSpring}
          whileHover={isExpandable ? { scale: 1.025 } : undefined}
          whileTap={isExpandable ? { scale: 0.98 } : undefined}
          style={tilt.style}
          {...tilt.handlers}
          className={`
            bg-card overflow-hidden h-full widget-shadow outline-none
            ${isExpandable ? "cursor-pointer" : ""}
          `}
          onClick={() => {
            if (isExpandable && !isExpanded) onExpand(id);
          }}
        >
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-sm shrink-0">{icon}</span>
              <h2 className="text-[15px] font-semibold text-label tracking-tight truncate">
                {title}
              </h2>
              {isExpandable && (
                <svg
                  className="ml-auto shrink-0 text-quaternary-label"
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                >
                  <path
                    d="M5.25 3.5l3.5 3.5-3.5 3.5"
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
      </div>

      <ExpandableOverlay
        layoutId={layoutId}
        isOpen={isExpanded}
        onClose={onCollapse}
        icon={icon}
        title={title}
      >
        {expandedContent}
      </ExpandableOverlay>
    </>
  );
}
