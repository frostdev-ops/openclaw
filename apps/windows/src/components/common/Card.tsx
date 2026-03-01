import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

export function Card({
  children,
  className = '',
  hover = false,
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  accent?: boolean;
}) {
  const baseClass = accent
    ? 'glass-card-accent'
    : hover
    ? 'glass-card-hover'
    : 'glass-card';

  if (hover) {
    return (
      <motion.div
        className={cn(baseClass, 'p-4', className)}
        whileHover={{ y: -3, boxShadow: '0 16px 38px rgba(14,165,233,0.14)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={cn(baseClass, 'p-4', className)}>
      {children}
    </div>
  );
}
