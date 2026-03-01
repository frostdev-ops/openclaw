import { Loader2 } from 'lucide-react';

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <Loader2
      size={size}
      className={`animate-spin text-primary-400 drop-shadow-[0_0_4px_rgba(14,165,233,0.4)] ${className}`}
    />
  );
}
