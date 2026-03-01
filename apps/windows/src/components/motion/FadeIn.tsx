import { motion, useReducedMotion } from 'motion/react';

export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { delay, duration: 0.4 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
