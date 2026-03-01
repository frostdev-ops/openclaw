import { useState, useCallback, useMemo } from "react";
import { useGateway } from "../gateway/context";
import { useGatewayRpc } from "../hooks/useGatewayRpc";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/common/Button";
import { FadeIn } from "../components/motion/FadeIn";
import { AnimatePresence, motion } from "motion/react";
import { cn, formatRelativeTime, formatTokens } from "../lib/utils";
import type { GatewaySessionRow } from "../gateway/types";
import type { PageId, PageState } from "../types";
import {
  MessagesSquare,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  Globe,
  User,
  Users,
  HelpCircle,
  Settings2,
  Hash,
  Cpu,
  Layers,
  Save,
  ExternalLink,
} from "lucide-react";

// --- Types ---

interface SessionsListResult {
  sessions: GatewaySessionRow[];
  count?: number;
  defaults?: { model?: string; contextTokens?: number };
}

interface SessionsProps {
  onNavigate: (page: PageId, state?: PageState) => void;
  pageState: PageState;
}

// --- Constants ---

type KindKey = "direct" | "group" | "global" | "unknown";

const KIND_BADGE_MAP: Record<KindKey, "info" | "primary" | "warning" | "default"> = {
  direct: "info",
  group: "primary",
  global: "warning",
  unknown: "default",
};

const KIND_ICON_MAP: Record<KindKey, React.ElementType> = {
  direct: User,
  group: Users,
  global: Globe,
  unknown: HelpCircle,
};

const LEVEL_OPTIONS = ["", "off", "low", "medium", "high", "max"] as const;

// --- Sub-components ---

function LevelEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-neutral-400 w-24 shrink-0">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs py-1.5 px-2 rounded-lg bg-neutral-800/80 border border-white/10 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500/50"
      >
        <option value="">default</option>
        {LEVEL_OPTIONS.filter((o) => o !== "").map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function SessionDetail({
  session,
  onPatch,
  patching,
}: {
  session: GatewaySessionRow;
  onPatch: (key: string, changes: Record<string, string>) => void;
  patching: boolean;
}) {
  const [thinkingLevel, setThinkingLevel] = useState(session.thinkingLevel ?? "");
  const [verboseLevel, setVerboseLevel] = useState(session.verboseLevel ?? "");
  const [reasoningLevel, setReasoningLevel] = useState(session.reasoningLevel ?? "");
  const [elevatedLevel, setElevatedLevel] = useState(session.elevatedLevel ?? "");

  const hasChanges =
    thinkingLevel !== (session.thinkingLevel ?? "") ||
    verboseLevel !== (session.verboseLevel ?? "") ||
    reasoningLevel !== (session.reasoningLevel ?? "") ||
    elevatedLevel !== (session.elevatedLevel ?? "");

  const handleSave = () => {
    const changes: Record<string, string> = {};
    if (thinkingLevel !== (session.thinkingLevel ?? "")) {
      changes["thinkingLevel"] = thinkingLevel;
    }
    if (verboseLevel !== (session.verboseLevel ?? "")) {
      changes["verboseLevel"] = verboseLevel;
    }
    if (reasoningLevel !== (session.reasoningLevel ?? "")) {
      changes["reasoningLevel"] = reasoningLevel;
    }
    if (elevatedLevel !== (session.elevatedLevel ?? "")) {
      changes["elevatedLevel"] = elevatedLevel;
    }
    onPatch(session.key, changes);
  };

  const infoRows: Array<{ label: string; value: string | number | undefined | null }> = [
    { label: "Key", value: session.key },
    { label: "Kind", value: session.kind },
    { label: "Surface", value: session.surface },
    { label: "Model", value: session.model },
    { label: "Provider", value: session.modelProvider },
    {
      label: "Input Tokens",
      value: session.inputTokens != null ? formatTokens(session.inputTokens) : undefined,
    },
    {
      label: "Output Tokens",
      value: session.outputTokens != null ? formatTokens(session.outputTokens) : undefined,
    },
    {
      label: "Total Tokens",
      value: session.totalTokens != null ? formatTokens(session.totalTokens) : undefined,
    },
  ];

  const visibleRows = infoRows.filter((r) => r.value != null && r.value !== "");

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Hash size={12} />
            Session Details
          </h4>
          <div className="space-y-1.5">
            {visibleRows.map((row) => (
              <div key={row.label} className="flex items-baseline gap-2 text-xs">
                <span className="text-neutral-500 w-28 shrink-0">{row.label}</span>
                <span className="text-neutral-200 font-mono break-all">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Settings2 size={12} />
            Level Controls
          </h4>
          <div className="space-y-2.5">
            <LevelEditor label="Thinking" value={thinkingLevel} onChange={setThinkingLevel} />
            <LevelEditor label="Verbose" value={verboseLevel} onChange={setVerboseLevel} />
            <LevelEditor label="Reasoning" value={reasoningLevel} onChange={setReasoningLevel} />
            <LevelEditor label="Elevated" value={elevatedLevel} onChange={setElevatedLevel} />
            <div className="pt-2">
              <Button
                variant="primary"
                disabled={!hasChanges || patching}
                loading={patching}
                onClick={handleSave}
              >
                <Save size={14} />
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  expanded,
  onToggle,
  onPatch,
  patching,
  onOpenReplay,
}: {
  session: GatewaySessionRow;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (key: string, changes: Record<string, string>) => void;
  patching: boolean;
  onOpenReplay: (key: string) => void;
}) {
  const kindKey = (session.kind ?? "unknown") as KindKey;
  const KindIcon = KIND_ICON_MAP[kindKey] ?? HelpCircle;

  return (
    <>
      <tr
        className="border-b border-neutral-800/50 hover:bg-neutral-800/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="pl-3 pr-1 py-3 w-8">
          {expanded ? (
            <ChevronDown size={14} className="text-neutral-500" />
          ) : (
            <ChevronRight size={14} className="text-neutral-500" />
          )}
        </td>

        <td className="py-3 pr-3">
          <div className="flex flex-col">
            <button
              type="button"
              className="text-sm text-neutral-200 truncate max-w-[160px] sm:max-w-[260px] hover:text-primary-400 transition-colors text-left inline-flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                onOpenReplay(session.key);
              }}
            >
              {session.label ?? session.displayName ?? session.key}
              <ExternalLink size={10} className="text-neutral-500 shrink-0" />
            </button>
            {(session.label ?? session.displayName) && (
              <span className="text-[11px] text-neutral-500 font-mono truncate max-w-[160px] sm:max-w-[260px]">
                {session.key}
              </span>
            )}
          </div>
        </td>

        <td className="py-3 pr-3">
          <Badge variant={KIND_BADGE_MAP[kindKey] ?? "default"}>
            <span className="inline-flex items-center gap-1">
              <KindIcon size={10} />
              {session.kind ?? "unknown"}
            </span>
          </Badge>
        </td>

        <td className="py-3 pr-3 hidden sm:table-cell">
          <span className="text-xs text-neutral-300 font-mono">
            {session.model ?? <span className="text-neutral-600">--</span>}
          </span>
        </td>

        <td className="py-3 pr-3 hidden md:table-cell">
          {session.totalTokens != null ? (
            <div className="flex flex-col">
              <span className="text-xs text-neutral-200">
                {formatTokens(session.totalTokens)}
              </span>
              <span className="text-[10px] text-neutral-500">
                {session.inputTokens != null ? formatTokens(session.inputTokens) : "0"} in /{" "}
                {session.outputTokens != null ? formatTokens(session.outputTokens) : "0"} out
              </span>
            </div>
          ) : (
            <span className="text-xs text-neutral-600">--</span>
          )}
        </td>

        <td className="py-3 pr-3">
          <span className="text-xs text-neutral-400">
            {session.updatedAtMs != null ? formatRelativeTime(session.updatedAtMs) : "--"}
          </span>
        </td>

        <td className="py-3 pr-3 hidden lg:table-cell">
          {session.surface ? (
            <span className="text-xs text-neutral-400">{session.surface}</span>
          ) : (
            <span className="text-xs text-neutral-600">--</span>
          )}
        </td>
      </tr>

      <AnimatePresence>
        {expanded && (
          <tr>
            <td colSpan={7}>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden border-b border-neutral-800/50 bg-neutral-900/40"
              >
                <SessionDetail session={session} onPatch={onPatch} patching={patching} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// --- Main Page ---

export function Sessions({ onNavigate, pageState: _pageState }: SessionsProps) {
  const { rpc } = useGateway();
  const { data, loading, error, refetch } = useGatewayRpc<SessionsListResult>("sessions.list");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [patchingKey, setPatchingKey] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refetch();
    // Allow visual feedback
    setTimeout(() => setRefreshing(false), 400);
  }, [refetch]);

  const handlePatch = useCallback(
    async (key: string, changes: Record<string, string>) => {
      setPatchingKey(key);
      setPatchError(null);
      try {
        const res = await rpc("sessions.patch", { key, ...changes });
        if (!res.ok) {
          setPatchError(res.error?.message ?? "Patch failed");
        } else {
          refetch();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Patch failed";
        setPatchError(msg);
      } finally {
        setPatchingKey(null);
      }
    },
    [rpc, refetch],
  );

  const sessions = useMemo(() => {
    if (!data?.sessions) {
      return [];
    }
    const sorted = [...data.sessions].toSorted((a, b) => {
      const aTime = a.updatedAtMs ?? 0;
      const bTime = b.updatedAtMs ?? 0;
      return bTime - aTime;
    });
    if (!searchQuery.trim()) {
      return sorted;
    }
    const q = searchQuery.toLowerCase().trim();
    return sorted.filter((s) => {
      const label = s.label?.toLowerCase() ?? "";
      const key = s.key.toLowerCase();
      const displayName = s.displayName?.toLowerCase() ?? "";
      const model = s.model?.toLowerCase() ?? "";
      const surface = s.surface?.toLowerCase() ?? "";
      return (
        label.includes(q) ||
        key.includes(q) ||
        displayName.includes(q) ||
        model.includes(q) ||
        surface.includes(q)
      );
    });
  }, [data?.sessions, searchQuery]);

  const defaults = data?.defaults;

  return (
    <div className="space-y-6">
      <FadeIn>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Sessions</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Manage active sessions, view token usage, and adjust level settings.
            </p>
          </div>
          <Button onClick={handleRefresh} loading={refreshing} variant="secondary">
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </FadeIn>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Sessions</p>
                <p className="text-2xl font-semibold text-neutral-100 mt-1">
                  {data.count ?? sessions.length}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary-500/15 to-primary-500/5">
                <Layers size={20} className="text-primary-400" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Default Model</p>
                <p className="text-lg font-semibold text-neutral-100 mt-1 font-mono">
                  {defaults?.model ?? <span className="text-neutral-600">none</span>}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-gradient-to-br from-info-500/15 to-info-500/5">
                <Cpu size={20} className="text-info-400" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Context Tokens</p>
                <p className="text-2xl font-semibold text-neutral-100 mt-1">
                  {defaults?.contextTokens != null ? (
                    formatTokens(defaults.contextTokens)
                  ) : (
                    <span className="text-neutral-600">--</span>
                  )}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-gradient-to-br from-success-500/15 to-success-500/5">
                <MessagesSquare size={20} className="text-success-400" />
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          placeholder="Filter by label, key, display name, model, or surface..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 py-2 px-3 text-sm rounded-lg bg-neutral-800/60 border border-white/10 text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50"
        />
      </div>

      {patchError && (
        <div className="rounded-md bg-error-500/10 border border-error-500/20 px-4 py-2.5 text-sm text-error-400">
          Patch failed: {patchError}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : error ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-sm text-error-400">{error}</p>
            <Button variant="secondary" className="mt-3" onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        </Card>
      ) : sessions.length === 0 && !searchQuery ? (
        <EmptyState
          icon={MessagesSquare}
          title="No sessions"
          description="No sessions are currently tracked by the gateway."
        />
      ) : sessions.length === 0 && searchQuery ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description={`No sessions match "${searchQuery}". Try a different search term.`}
        />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-700/50 bg-neutral-900/30">
                  <th className="pl-3 pr-1 py-2.5 w-8" />
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Label / Key
                  </th>
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Kind
                  </th>
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider hidden sm:table-cell">
                    Model
                  </th>
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider hidden md:table-cell">
                    Tokens
                  </th>
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="py-2.5 pr-3 text-xs font-medium text-neutral-500 uppercase tracking-wider hidden lg:table-cell">
                    Surface
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <SessionRow
                    key={session.key}
                    session={session}
                    expanded={expandedKey === session.key}
                    onToggle={() =>
                      setExpandedKey((prev) => (prev === session.key ? null : session.key))
                    }
                    onPatch={handlePatch}
                    patching={patchingKey === session.key}
                    onOpenReplay={(key) => onNavigate("sessions", { sessionKey: key })}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-neutral-700/50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {sessions.length} of {data?.count ?? sessions.length} session
              {(data?.count ?? sessions.length) !== 1 ? "s" : ""}
              {searchQuery && " (filtered)"}
            </span>
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Spinner size={12} />
                Refreshing...
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
