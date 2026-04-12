export const cardSpring = {
  layout: {
    type: "spring" as const,
    stiffness: 600,
    damping: 38,
    mass: 0.4,
  },
};

export const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

// Enter: opacity + y + blur for a polished feel
export const cardReveal = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring" as const, stiffness: 300, damping: 26 },
  },
};
