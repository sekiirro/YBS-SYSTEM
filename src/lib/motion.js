/**
 * YBS Motion System — reusable Framer Motion variants & helpers
 * Uses framer-motion v11 (already installed in project).
 */

// ─── Page / Container ─────────────────────────────────────────────────────────

export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.18, ease: 'easeIn' } },
};

// ─── Staggered children list ───────────────────────────────────────────────────

export const listVariants = {
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

export const listItemVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Fade up (cards, sections, charts) ────────────────────────────────────────

export const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
};

// ─── Scale fade (modals, tooltips, dropdowns) ─────────────────────────────────

export const scaleFade = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, scale: 0.97, transition: { duration: 0.15, ease: 'easeIn' } },
};

// ─── Staggered card grid ──────────────────────────────────────────────────────

export const cardGridVariants = {
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

export const cardItemVariants = {
  initial: { opacity: 0, y: 16, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Sidebar item ─────────────────────────────────────────────────────────────

export const sidebarItemVariants = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns Framer Motion `whileHover` + `whileTap` props for card lift.
 * Use: `<motion.div {...cardHover}>…</motion.div>`
 */
export const cardHover = {
  whileHover: { y: -2, transition: { duration: 0.2, ease: 'easeOut' } },
};

/**
 * Subtle button interaction — micro scale + brightness.
 */
export const buttonMotion = {
  whileHover: { scale: 1.015, transition: { duration: 0.15, ease: 'easeOut' } },
  whileTap:   { scale: 0.975, transition: { duration: 0.1,  ease: 'easeIn'  } },
};

/**
 * Icon button hover.
 */
export const iconButtonMotion = {
  whileHover: { scale: 1.08, transition: { duration: 0.15, ease: 'easeOut' } },
  whileTap:   { scale: 0.92, transition: { duration: 0.1,  ease: 'easeIn'  } },
};
