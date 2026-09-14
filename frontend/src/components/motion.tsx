// Pathwise motion system — one thin, consistent layer over Framer Motion.
//
// Rules:
//   - 150-240ms, ease-out. Motion communicates state; it is never decoration.
//   - Everything respects prefers-reduced-motion: App mounts
//     <MotionConfig reducedMotion="user"> once, which disables transforms
//     app-wide for those users (the CSS kill-switch covers the rest).
//   - Pages fade+rise via PageTransition (mounted in AppShell); lists and
//     grids stagger via StaggerContainer + StaggerItem.
import { motion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

interface BoxProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** Whole-page enter: fade + slight rise. Used once, in AppShell. */
export function PageTransition({ children, className, style }: BoxProps) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};
const staggerChild = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
};

/** Wrap a list/grid; each StaggerItem inside enters with a soft cascade.
 *  Pass the layout class (courses-grid, heatmap-grid, …) via className. */
export function StaggerContainer({ children, className, style }: BoxProps) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerParent}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, style, title }: BoxProps) {
  return (
    <motion.div className={className} style={style} title={title} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/** One-off soft entrance for a single element. */
export function FadeIn({
  children,
  className,
  style,
  delay = 0,
}: BoxProps & { delay?: number }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Pop-in for celebratory moments (badges, level-ups, matched pairs). */
export function ScaleIn({
  children,
  className,
  style,
  delay = 0,
}: BoxProps & { delay?: number }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.24, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
