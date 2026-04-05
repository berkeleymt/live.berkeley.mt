import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTilt } from "../hooks/useTilt";
import { ExpandableOverlay } from "./ExpandableOverlay";
import { cardSpring } from "./springs";

interface WidgetCardProps {
  /** Title shown only in the expanded overlay header */
  title: string;
  /** Icon shown only in the expanded overlay header */
  icon: ReactNode;
  /** Compact content — owns the entire card visual */
  children: ReactNode;
  expandedContent?: ReactNode;
  /** "card" (default) or "list" (each child is its own bubble) */
  expandedVariant?: "card" | "list";
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
  expandedVariant,
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
      <div style={{ perspective: 800 }} className="h-full">
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
          {children}
        </motion.div>
      </div>

      <ExpandableOverlay
        layoutId={layoutId}
        isOpen={isExpanded}
        onClose={onCollapse}
        icon={icon}
        title={title}
        variant={expandedVariant}
      >
        {expandedContent}
      </ExpandableOverlay>
    </>
  );
}
