import { type MouseEvent, useCallback } from "react";
import { useMotionValue, useSpring } from "framer-motion";

const TILT_DEG = 6;
const tiltSpring = { stiffness: 300, damping: 20, mass: 0.5 };

export function useTilt(enabled: boolean) {
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, tiltSpring);
  const springY = useSpring(rotateY, tiltSpring);

  const onMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      rotateY.set(x * TILT_DEG);
      rotateX.set(-y * TILT_DEG);
    },
    [enabled, rotateX, rotateY],
  );

  const onMouseLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  return {
    style: { rotateX: springX, rotateY: springY },
    handlers: { onMouseMove, onMouseLeave },
  };
}
