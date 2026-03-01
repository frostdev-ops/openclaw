import { useMemo } from "react";
import { usePollingRpc } from "../../hooks/usePollingRpc";
import { formatTokens, cn } from "../../lib/utils";
import { Cpu } from "lucide-react";
import type { GatewaySessionRow } from "../../gateway/types";

interface SessionsListResult {
  sessions: GatewaySessionRow[];
  defaults?: { model?: string; contextTokens?: number };
}

export function ChatStatusBar({ sessionKey }: { sessionKey: string }) {
  const { data } = usePollingRpc<SessionsListResult>("sessions.list", undefined, 12_000);

  const session = useMemo(() => {
    if (!data?.sessions) {
      return null;
    }
    return data.sessions.find((s) => s.key === sessionKey) ?? null;
  }, [data, sessionKey]);

  const model = session?.model ?? data?.defaults?.model ?? null;
  const provider = session?.modelProvider ?? null;
  const totalTokens = session?.totalTokens ?? 0;
  const contextTokens = data?.defaults?.contextTokens ?? 0;

  const pct = contextTokens > 0 ? Math.min((totalTokens / contextTokens) * 100, 100) : 0;
  const barColor = pct > 95 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-primary-500";

  return (
    <div className="flex items-center gap-3 px-3 md:px-4 py-2 border-t border-white/10 bg-neutral-950/35 backdrop-blur-xl text-[11px] text-neutral-500">
      <Cpu size={12} className="shrink-0 text-primary-400/70" />

      {model ? (
        <span className="font-mono text-neutral-300 truncate max-w-[220px]">{model}</span>
      ) : (
        <span className="text-neutral-600">--</span>
      )}

      {provider && (
        <span className="px-1.5 py-0.5 rounded-full border border-white/10 bg-neutral-800/90 text-neutral-400 text-[10px] leading-none shrink-0">
          {provider}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {contextTokens > 0 ? (
          <>
            <span className="tabular-nums">
              {formatTokens(totalTokens)} / {formatTokens(contextTokens)}
            </span>
            <div className="w-20 h-1.5 rounded-full bg-neutral-900 border border-white/10 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tabular-nums w-8 text-right">{pct.toFixed(0)}%</span>
          </>
        ) : (
          <span className="text-neutral-600">--</span>
        )}
      </div>
    </div>
  );
}
