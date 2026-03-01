import { cn } from '../../lib/utils';

type PillStatus = 'online' | 'offline' | 'warning' | 'error';

const STATUS_COLORS: Record<PillStatus, string> = {
  online: 'bg-success-500',
  offline: 'bg-neutral-500',
  warning: 'bg-warning-500',
  error: 'bg-error-500',
};

const PULSE_CLASSES: Partial<Record<PillStatus, string>> = {
  online: 'pulse-online',
  warning: 'pulse-warning',
  error: 'pulse-error',
};

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
      <span
        className={cn(
          'w-2.5 h-2.5 rounded-full',
          STATUS_COLORS[status],
          PULSE_CLASSES[status],
        )}
      />
      {label && <span>{label}</span>}
    </span>
  );
}
