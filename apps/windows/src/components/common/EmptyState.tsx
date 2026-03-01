import { motion } from 'motion/react';
import { FadeIn } from '../motion/FadeIn';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 md:py-16 text-center">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Icon size={48} className="text-neutral-600 mb-4" />
      </motion.div>
      <FadeIn delay={0.1}>
        <h3 className="text-lg font-medium text-neutral-300 mb-1">{title}</h3>
      </FadeIn>
      {description && (
        <FadeIn delay={0.2}>
          <p className="text-sm text-neutral-500 max-w-md">{description}</p>
        </FadeIn>
      )}
    </div>
  );
}
