import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'relative overflow-hidden text-white bg-[linear-gradient(110deg,rgba(2,132,199,1)_0%,rgba(14,165,233,1)_45%,rgba(56,189,248,0.9)_100%)] bg-[length:180%_100%] bg-[position:0%_50%] hover:bg-[position:100%_50%] before:pointer-events-none before:absolute before:inset-y-0 before:left-[-60%] before:w-1/3 before:-skew-x-12 before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:transition-[left] before:duration-500 hover:before:left-[130%] hover:shadow-[0_6px_24px_rgba(14,165,233,0.24)]',
  secondary: 'backdrop-blur-sm bg-white/[0.06] hover:bg-white/[0.12] text-neutral-200 border border-white/12',
  ghost: 'hover:bg-white/[0.08] text-neutral-300',
  danger: 'bg-error-600 hover:bg-error-500 text-white',
};

export function Button({
  children,
  variant = 'secondary',
  loading = false,
  className = '',
  ...props
}: Omit<HTMLMotionProps<'button'>, 'ref' | 'children'> & {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <motion.button
      className={`touch-manipulation inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold tracking-[0.01em] transition-[background-position,background-color,border-color,color,box-shadow,transform] disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}
      disabled={loading || props.disabled}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </motion.button>
  );
}
