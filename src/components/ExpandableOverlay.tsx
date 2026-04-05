import { type ReactNode, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDialog, usePreventScroll, FocusScope, DismissButton } from "react-aria";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { cardSpring } from "./springs";

interface ExpandableOverlayProps {
  layoutId: string;
  isOpen: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}

function DialogContent({
  layoutId,
  onClose,
  icon,
  title,
  children,
}: Omit<ExpandableOverlayProps, "isOpen">) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { dialogProps, titleProps } = useDialog({ role: "dialog" }, dialogRef);

  usePreventScroll();
  useEscapeKey(true, onClose);

  return (
    <FocusScope contain restoreFocus autoFocus>
      <motion.div
        ref={dialogRef}
        {...dialogProps}
        layoutId={layoutId}
        transition={cardSpring}
        className="relative bg-card overflow-hidden pointer-events-auto
          w-full max-w-lg widget-shadow-lg
          max-h-[85vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <DismissButton onDismiss={onClose} />
        <div className="px-5 py-3 flex items-center gap-2 shrink-0 border-b border-separator">
          <span className="text-sm">{icon}</span>
          <h2
            {...titleProps}
            className="text-[17px] font-semibold text-label tracking-tight flex-1"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-tertiary-label hover:text-secondary-label transition-colors
              w-8 h-8 flex items-center justify-center rounded-full
              bg-bg"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto overscroll-contain">
          {children}
        </div>
        <DismissButton onDismiss={onClose} />
      </motion.div>
    </FocusScope>
  );
}

export function ExpandableOverlay({
  isOpen,
  onClose,
  ...rest
}: ExpandableOverlayProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" as const }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <DialogContent onClose={onClose} {...rest}>
              {rest.children}
            </DialogContent>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
