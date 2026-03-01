type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-neutral-800/80 text-neutral-300 border border-white/10',
  success: 'bg-success-500/10 text-success-400 border border-success-500/20 shadow-[inset_0_0_8px_rgba(16,185,129,0.1)]',
  warning: 'bg-warning-500/10 text-warning-400 border border-warning-500/20 shadow-[inset_0_0_8px_rgba(245,158,11,0.1)]',
  error: 'bg-error-500/10 text-error-400 border border-error-500/20 shadow-[inset_0_0_8px_rgba(239,68,68,0.1)]',
  info: 'bg-info-500/10 text-info-400 border border-info-500/20 shadow-[inset_0_0_8px_rgba(59,130,246,0.1)]',
  primary: 'bg-primary-500/10 text-primary-400 border border-primary-500/20 shadow-[inset_0_0_8px_rgba(14,165,233,0.1)]',
};

export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs leading-none font-semibold tracking-[0.02em] ${VARIANTS[variant]}`}>
      {children}
    </span>
  );
}
