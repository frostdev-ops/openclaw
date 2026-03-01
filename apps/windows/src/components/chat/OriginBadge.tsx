import { getProviderMeta } from "../../lib/providers";
import { cn } from "../../lib/utils";
import { ArrowRight, Zap } from "lucide-react";
import type { MessageOrigin } from "./types";

export function OriginBadge({ origin }: { origin: MessageOrigin }) {
  const { provider, from: _from, to, label, surface, routedModel } = origin;
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;

  if (!provider && !surface && !to && !routedModel) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] leading-none align-baseline">
      {provider && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold tracking-[0.03em]",
            "bg-neutral-900/85 border border-white/10",
            meta.color,
          )}
        >
          <Icon size={10} />
          {label || meta.label}
        </span>
      )}

      {routedModel && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold tracking-[0.03em] bg-neutral-900/85 border border-white/10 text-amber-400">
          <Zap size={9} />
          {routedModel}
        </span>
      )}

      {surface && !provider && <span className="text-neutral-500">{surface}</span>}

      {to && (
        <>
          <ArrowRight size={8} className="text-neutral-600" />
          <span className="text-neutral-500 truncate max-w-[120px] tabular-nums" title={to}>
            {to}
          </span>
        </>
      )}
    </span>
  );
}
