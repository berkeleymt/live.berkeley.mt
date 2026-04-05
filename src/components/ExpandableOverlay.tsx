import { type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDialog, usePreventScroll, FocusScope, DismissButton } from "react-aria";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { cardSpring } from "./springs";

type OverlayVariant = "card" | "list";

interface ExpandableOverlayProps {
  layoutId: string;
  isOpen: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  /** "card" (default): single frosted card. "list": transparent bg, header + children are separate bubbles. */
  variant?: OverlayVariant;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      className="text-tertiary-label hover:text-secondary-label transition-colors
        w-8 h-8 flex items-center justify-center rounded-full
        bg-black/5 shrink-0"
      aria-label="Close"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function DialogContent({
  layoutId,
  onClose,
  icon,
  title,
  children,
  variant = "card",
}: Omit<ExpandableOverlayProps, "isOpen">) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { dialogProps, titleProps } = useDialog({ role: "dialog" }, dialogRef);
  // Strip event-handler props that conflict between react-aria and framer-motion
  const {
    onAnimationStart: _a,
    onDrag: _d,
    onDragStart: _ds,
    onDragEnd: _de,
    ...safeDialogProps
  } = dialogProps;

  usePreventScroll();
  useEscapeKey(true, onClose);

  if (variant === "list") {
    return (
      <FocusScope contain restoreFocus autoFocus>
        <motion.div
          ref={dialogRef}
          {...safeDialogProps}
          layoutId={layoutId}
          transition={cardSpring}
          className="relative pointer-events-auto w-full max-w-lg
            flex flex-col outline-none my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <DismissButton onDismiss={onClose} />
          {/* Header bubble */}
          <div className="glass-heavy widget-shadow-lg px-5 py-3 flex items-center gap-2 shrink-0 mb-3">
            <span className="text-sm">{icon}</span>
            <h2
              {...titleProps}
              className="text-[17px] font-semibold text-label tracking-tight flex-1"
            >
              {title}
            </h2>
            <CloseButton onClose={onClose} />
          </div>
          {/* Children — each child renders its own bubble */}
          {children}
          <DismissButton onDismiss={onClose} />
        </motion.div>
      </FocusScope>
    );
  }

  return (
    <FocusScope contain restoreFocus autoFocus>
      <motion.div
        ref={dialogRef}
        {...safeDialogProps}
        layoutId={layoutId}
        transition={cardSpring}
        className="relative glass-heavy overflow-hidden pointer-events-auto
          w-full max-w-lg widget-shadow-lg
          max-h-[85vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <DismissButton onDismiss={onClose} />
        <div className="px-5 py-3 flex items-center gap-2 shrink-0 border-b border-white/30">
          <span className="text-sm">{icon}</span>
          <h2
            {...titleProps}
            className="text-[17px] font-semibold text-label tracking-tight flex-1"
          >
            {title}
          </h2>
          <CloseButton onClose={onClose} />
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
  const portalTarget = document.getElementById("overlay-root") ?? document.body;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/25 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" as const }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            className={`fixed inset-0 z-50 flex justify-center pointer-events-none ${
              rest.variant === "list" ? "items-start overflow-y-auto p-4" : "items-center p-4"
            }`}
          >
            <DialogContent onClose={onClose} {...rest}>
              {rest.children}
            </DialogContent>
          </div>
        </>
      )}
    </AnimatePresence>,
    portalTarget,
  );
}
