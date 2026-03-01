import { useMemo, useState, useEffect } from "react";
import { useGateway } from "../gateway/context";
import { usePresenceStore } from "../stores/connection";
import { startNode, stopNode } from "../tauri/commands";
import type { NodeStatusString } from "../tauri/types";
import type { CronStatus, StatusSummary, PresenceEntry } from "../gateway/types";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { StatusPill } from "../components/common/StatusPill";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { AnimatedCounter } from "../components/common/AnimatedCounter";
import { Sparkline } from "../components/common/Sparkline";
import { Button } from "../components/common/Button";
import { PageTransition } from "../components/motion/PageTransition";
import { FadeIn } from "../components/motion/FadeIn";
import { StaggerContainer, StaggerItem } from "../components/motion/StaggerContainer";
import { cn, formatRelativeTime } from "../lib/utils";
import { motion } from "motion/react";
import {
  Activity,
  Server,
  Users,
  Zap,
  Timer,
  Search,
  ShieldAlert,
  CheckCircle2,
  Cpu,
  Play,
  Square,
  ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

type ScalarEntry = { path: string; value: string | number | boolean | null };

const MAX_SCALARS = 320;
const SIGNAL_KEY_PATTERN =
  /(ok|healthy|running|connected|ready|active|online|available|alive|configured|enabled|linked)$/i;

// ---------------------------------------------------------------------------
// Scalar collection helpers (for Health Insights)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectScalars(
  value: unknown,
  path = "root",
  depth = 0,
  out: ScalarEntry[] = [],
): ScalarEntry[] {
  if (out.length >= MAX_SCALARS || depth > 7) { return out; }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    out.push({ path, value });
    return out;
  }

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 30);
    for (let i = 0; i < limit; i += 1) {
      collectScalars(value[i], `${path}[${i}]`, depth + 1, out);
      if (out.length >= MAX_SCALARS) { break; }
    }
    return out;
  }

  if (isRecord(value)) {
    for (const key of [...Object.keys(value)].sort()) {
      collectScalars(value[key], path === "root" ? key : `${path}.${key}`, depth + 1, out);
      if (out.length >= MAX_SCALARS) { break; }
    }
  }

  return out;
}

function humanizeKey(value: string): string {
  return value
    .replace(/\[(\d+)\]/g, " $1 ")
    .replace(/[_-]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function lastSegment(path: string): string {
  const segment = path.split(".").pop() ?? path;
  return segment.replace(/\[\d+\]$/, "");
}

function shortPath(path: string, groupKey: string): string {
  const prefix = `${groupKey}.`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function isSensitivePath(path: string): boolean {
  return /(token|secret|api.?key|password|authToken|bearer|privateKey)/i.test(path);
}

function maskSecret(value: string): string {
  if (!value) { return "empty"; }
  if (value.length <= 8) { return "••••"; }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function isLikelyTimestamp(path: string, value: number): boolean {
  return /(ts|timestamp|updated|created|last|time|at)$/i.test(lastSegment(path)) && value > 1e11;
}

function formatDurationMs(value: number): string {
  if (value < 1000) { return `${Math.round(value)} ms`; }
  const sec = value / 1000;
  if (sec < 60) { return `${sec.toFixed(1)} s`; }
  const min = sec / 60;
  if (min < 60) { return `${min.toFixed(1)} min`; }
  const hrs = min / 60;
  return `${hrs.toFixed(1)} h`;
}

function formatBytesValue(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1024) { return `${value.toFixed(0)} B`; }
  const units = ["KB", "MB", "GB", "TB"];
  let n = abs / 1024;
  let unitIdx = 0;
  while (n >= 1024 && unitIdx < units.length - 1) {
    n /= 1024;
    unitIdx += 1;
  }
  const signed = value < 0 ? -n : n;
  return `${signed.toFixed(1)} ${units[unitIdx]}`;
}

function formatNumber(path: string, value: number): string {
  if (/ms|latency|duration|interval|timeout|elapsed/i.test(path)) {
    return formatDurationMs(value);
  }
  if (/(bytes|byte|memory|mem|heap|rss|size)/i.test(path) && Math.abs(value) >= 1024) {
    return formatBytesValue(value);
  }
  if (isLikelyTimestamp(path, value)) {
    return new Date(value).toLocaleString();
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatScalarValue(entry: ScalarEntry): string {
  const { path, value } = entry;
  if (typeof value === "string") {
    return isSensitivePath(path) ? maskSecret(value) : value;
  }
  if (typeof value === "number") {
    return formatNumber(path, value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "null";
}

function metricPercent(path: string, value: number): number | null {
  if (!Number.isFinite(value)) { return null; }
  if (!/(percent|ratio|usage|util|cpu|memory|mem|heap|load|score)/i.test(path)) { return null; }
  if (value >= 0 && value <= 1) { return Math.round(value * 100); }
  if (value >= 0 && value <= 100) { return Math.round(value); }
  return null;
}

function metricPriority(path: string): number {
  if (/(uptime|latency|response|duration|elapsed|ping)/i.test(path)) { return 0; }
  if (/(cpu|memory|heap|rss|load|util|usage)/i.test(path)) { return 1; }
  if (/(errors?|fail|retry|reconnect|queue)/i.test(path)) { return 2; }
  return 3;
}

// ---------------------------------------------------------------------------
// Overview page
// ---------------------------------------------------------------------------

interface OverviewProps {
  status: NodeStatusString;
  onStatusChange: (s: NodeStatusString) => void;
  onNavigateToLogs: () => void;
}

export function Overview({ status, onStatusChange, onNavigateToLogs }: OverviewProps) {
  const { status: gwStatus, hello, rpc } = useGateway();
  const connected = gwStatus.state === "connected";
  const presence = usePresenceStore((state) => state.entries);

  // Fetch cron status
  const [cronStatus, setCronStatus] = useState<CronStatus | null>(null);
  useEffect(() => {
    if (!connected) { return; }
    void rpc<CronStatus>("cron.status", {}).then((res) => {
      if (res.ok && res.payload) { setCronStatus(res.payload); }
    });
  }, [connected, rpc]);

  // Fetch status data for health insights
  const [statusData, setStatusData] = useState<StatusSummary | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  useEffect(() => {
    if (!connected) { return; }
    setStatusLoading(true);
    void rpc<StatusSummary>("status", {}).then((res) => {
      if (res.ok && res.payload) { setStatusData(res.payload); }
    }).finally(() => setStatusLoading(false));
  }, [connected, rpc]);

  // Track presence history for sparkline
  const [presenceHistory, setPresenceHistory] = useState<{ ts: number; value: number }[]>([]);
  useEffect(() => {
    setPresenceHistory((prev) => {
      const next = [...prev, { ts: Date.now(), value: presence.length }];
      return next.slice(-30);
    });
  }, [presence.length]);

  const handleStart = async () => {
    try {
      onStatusChange("starting");
      await startNode();
    } catch {
      onStatusChange("error");
    }
  };
  const handleStop = async () => {
    try {
      await stopNode();
      onStatusChange("stopped");
    } catch {
      onStatusChange("error");
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Overview</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Gateway status, entry points, and a fast health read.
            </p>
          </div>
        </FadeIn>

        {/* Stat cards */}
        <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StaggerItem>
            <StatCard
              icon={Server}
              label="Protocol"
              value={hello ? `v${hello.protocol}` : "\u2014"}
              iconColor="from-primary-500/15 to-primary-500/5"
              iconTextColor="text-primary-400"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Users}
              label="Presence"
              numericValue={presence.length}
              iconColor="from-success-500/15 to-success-500/5"
              iconTextColor="text-success-400"
              sparklineData={presenceHistory}
              sparklineColor="var(--color-success-400)"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Activity}
              label="Methods"
              numericValue={hello?.features?.methods?.length}
              iconColor="from-info-500/15 to-info-500/5"
              iconTextColor="text-info-400"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Timer}
              label="Cron Jobs"
              numericValue={cronStatus?.jobs}
              badge={cronStatus?.enabled ? "active" : "paused"}
              iconColor="from-warning-500/15 to-warning-500/5"
              iconTextColor="text-warning-400"
            />
          </StaggerItem>
        </StaggerContainer>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Connected Instances */}
          <FadeIn delay={0.2}>
            <Card>
              <h2 className="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                <Users size={16} className="text-primary-400" />
                Connected Instances
              </h2>
              {presence.length === 0 ? (
                <EmptyState icon={Users} title="No instances" description="No presence entries found." />
              ) : (
                <StaggerContainer className="space-y-3">
                  {presence.map((entry, i) => (
                    <StaggerItem key={entry.key ?? i}>
                      <PresenceRow entry={entry} />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              )}
            </Card>
          </FadeIn>

          {/* Health Insights */}
          <FadeIn delay={0.3}>
            <HealthInsightsPanel statusData={statusData} loading={statusLoading} />
          </FadeIn>
        </div>

        {/* Node Control (Tauri-specific) */}
        <FadeIn delay={0.35}>
          <Card>
            <h2 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
              <Cpu size={16} className="text-primary-400" />
              Node Control
            </h2>
            <div className="flex items-center gap-3 mb-3">
              <Button
                variant="primary"
                disabled={status === "running" || status === "starting"}
                onClick={() => void handleStart()}
              >
                <Play size={14} />
                Start
              </Button>
              <Button
                variant="secondary"
                disabled={status === "stopped"}
                onClick={() => void handleStop()}
              >
                <Square size={14} />
                Stop
              </Button>
              <Button
                variant="ghost"
                onClick={onNavigateToLogs}
                className="ml-auto"
              >
                <ExternalLink size={14} />
                View Logs
              </Button>
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <StatusPill
                status={
                  status === "running" ? "online" : status === "error" ? "error" : "offline"
                }
                label={status}
              />
              {gwStatus.state === "connected" && gwStatus.serverVersion && (
                <span>
                  Gateway {gwStatus.serverVersion} · conn {gwStatus.connId?.slice(0, 8)}
                </span>
              )}
            </div>
            {gwStatus.state === "disconnected" && (
              <p className="text-xs text-neutral-500 mt-2">
                Gateway disconnected — start the node to reconnect.
              </p>
            )}
            {gwStatus.state === "error" && (
              <p className="text-xs text-error-400 mt-2">{gwStatus.error ?? "Connection error"}</p>
            )}
          </Card>
        </FadeIn>

        {/* Gateway Info */}
        {hello && (
          <FadeIn delay={0.4}>
            <GatewayInfoPanel hello={hello} />
          </FadeIn>
        )}
      </div>
    </PageTransition>
  );
}

// ---------------------------------------------------------------------------
// Presence Row
// ---------------------------------------------------------------------------

function PresenceRow({ entry }: { entry: PresenceEntry }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <StatusPill status="online" />
          <span className="text-sm text-neutral-200">
            {entry.displayName ?? entry.clientId ?? "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {entry.roles?.map((role) => (
            <Badge key={role} variant="info">{role}</Badge>
          ))}
          {entry.version && (
            <span className="text-xs text-neutral-500">v{entry.version}</span>
          )}
          {entry.platform && (
            <span className="text-xs text-neutral-500">{entry.platform}</span>
          )}
        </div>
      </div>
      <div className="text-right">
        {entry.mode && <Badge variant="default">{entry.mode}</Badge>}
        {entry.connectedAtMs && (
          <div className="text-xs text-neutral-500 mt-1">
            {formatRelativeTime(entry.connectedAtMs)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  numericValue,
  badge,
  iconColor = "from-primary-500/15 to-primary-500/5",
  iconTextColor = "text-primary-400",
  sparklineData,
  sparklineColor,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  numericValue?: number | null;
  badge?: string;
  iconColor?: string;
  iconTextColor?: string;
  sparklineData?: { ts: number; value: number }[];
  sparklineColor?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-semibold text-neutral-100 mt-1">
            {numericValue != null ? (
              <AnimatedCounter value={numericValue} />
            ) : (
              value ?? "\u2014"
            )}
          </p>
        </div>
        <div className={cn("p-2 rounded-lg bg-gradient-to-br", iconColor)}>
          <Icon size={20} className={iconTextColor} />
        </div>
      </div>
      {sparklineData && sparklineData.length >= 2 && (
        <div className="mt-2">
          <Sparkline data={sparklineData} color={sparklineColor} />
        </div>
      )}
      {badge && (
        <div className="mt-2">
          <Badge variant={badge === "active" ? "success" : "warning"}>{badge}</Badge>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SummaryMetric (for Health / Gateway Info panels)
// ---------------------------------------------------------------------------

function SummaryMetric({
  label,
  value,
  prefix,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  prefix?: string;
  icon: React.ElementType;
  tone?: "default" | "success" | "warning" | "error" | "info" | "primary";
}) {
  const toneClass: Record<string, string> = {
    default: "text-neutral-300 bg-neutral-800/70",
    success: "text-success-300 bg-success-500/10",
    warning: "text-warning-300 bg-warning-500/10",
    error: "text-error-300 bg-error-500/10",
    info: "text-info-300 bg-info-500/10",
    primary: "text-primary-300 bg-primary-500/10",
  };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/30 p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-neutral-500">{label}</p>
        <div className={cn("rounded p-1", toneClass[tone])}>
          <Icon size={12} />
        </div>
      </div>
      <div className="text-base font-semibold text-neutral-100 mt-1">
        <AnimatedCounter value={value} prefix={prefix ?? ""} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health Insights Panel
// ---------------------------------------------------------------------------

function HealthInsightsPanel({
  statusData,
  loading,
}: {
  statusData: StatusSummary | null;
  loading: boolean;
}) {
  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();

  const scalarEntries = useMemo(() => collectScalars(statusData), [statusData]);

  const booleanEntries = useMemo(
    () => scalarEntries.filter((entry): entry is ScalarEntry & { value: boolean } => typeof entry.value === "boolean"),
    [scalarEntries],
  );

  const signalEntries = useMemo(() => {
    const strict = booleanEntries.filter((entry) => SIGNAL_KEY_PATTERN.test(lastSegment(entry.path)));
    return strict.length > 0 ? strict : booleanEntries;
  }, [booleanEntries]);

  const healthySignals = signalEntries.filter((entry) => entry.value).length;
  const unhealthySignals = signalEntries.length - healthySignals;
  const healthScore = signalEntries.length > 0 ? Math.round((healthySignals / signalEntries.length) * 100) : null;

  const numericEntries = useMemo(
    () => scalarEntries.filter((entry): entry is ScalarEntry & { value: number } => typeof entry.value === "number"),
    [scalarEntries],
  );

  const topMetrics = useMemo(
    () => [...numericEntries].sort((a: typeof numericEntries[number], b: typeof numericEntries[number]) => metricPriority(a.path) - metricPriority(b.path)).slice(0, 8),
    [numericEntries],
  );

  const grouped = useMemo(() => {
    if (!isRecord(statusData)) { return [] as Array<{ key: string; entries: ScalarEntry[]; pass: number; fail: number }>; }

    return [...Object.keys(statusData)]
      .sort()
      .map((key: string) => {
        const groupEntries = collectScalars(statusData[key], key);
        const filteredEntries = filterLower
          ? groupEntries.filter((entry) => {
              const rendered = formatScalarValue(entry).toLowerCase();
              return entry.path.toLowerCase().includes(filterLower) || rendered.includes(filterLower);
            })
          : groupEntries;

        const pass = filteredEntries.filter((entry) => typeof entry.value === "boolean" && entry.value).length;
        const fail = filteredEntries.filter((entry) => typeof entry.value === "boolean" && !entry.value).length;

        return { key, entries: filteredEntries, pass, fail };
      })
      .filter((group: { key: string; entries: ScalarEntry[]; pass: number; fail: number }) => group.entries.length > 0)
      .sort((a: { entries: ScalarEntry[] }, b: { entries: ScalarEntry[] }) => b.entries.length - a.entries.length);
  }, [statusData, filterLower]);

  return (
    <Card accent>
      <h2 className="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
        <Zap size={16} className="text-success-400" />
        Health
      </h2>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !statusData ? (
        <p className="text-sm text-neutral-500">No health data available.</p>
      ) : (
        <div className="space-y-4">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryMetric label="Signals" value={signalEntries.length} icon={ShieldAlert} />
            <SummaryMetric label="Passing" value={healthySignals} icon={CheckCircle2} tone="success" />
            <SummaryMetric label="Failing" value={unhealthySignals} icon={ShieldAlert} tone={unhealthySignals > 0 ? "error" : "default"} />
            <SummaryMetric label="Metrics" value={numericEntries.length} icon={Cpu} tone="info" />
          </div>

          {/* Signal pass rate bar */}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
              <span>Signal Pass Rate</span>
              <span className="font-mono">{healthScore != null ? `${healthScore}%` : "n/a"}</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <motion.div
                className={cn(
                  "h-full",
                  healthScore != null && healthScore >= 75
                    ? "bg-success-500"
                    : healthScore != null && healthScore >= 50
                    ? "bg-warning-500"
                    : "bg-error-500",
                )}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(100, healthScore ?? 0))}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 20 }}
              />
            </div>
          </div>

          {/* Filter */}
          <div>
            <label className="text-xs text-neutral-400 flex items-center gap-2 mb-1">
              <Search size={13} />
              Filter health fields
            </label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search path or value..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-primary-500"
            />
          </div>

          {/* Top metrics */}
          {topMetrics.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {topMetrics.map((entry: typeof topMetrics[number]) => {
                const pct = metricPercent(entry.path, entry.value);
                return (
                  <motion.div
                    key={entry.path}
                    className="rounded-md border border-neutral-800 bg-neutral-900/30 p-2"
                    whileHover={{ y: -1 }}
                    transition={{ type: "spring", stiffness: 350, damping: 24 }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-400 truncate">{humanizeKey(lastSegment(entry.path))}</span>
                      <span className="text-xs text-neutral-200 font-mono">{formatScalarValue(entry)}</span>
                    </div>
                    {pct != null && (
                      <div className="mt-2 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                        <motion.div
                          className="h-full bg-primary-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                          transition={{ type: "spring", stiffness: 120, damping: 20 }}
                        />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Grouped health fields */}
          {grouped.length === 0 ? (
            <p className="text-sm text-neutral-500">No matching health fields.</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {grouped.map((group: typeof grouped[number], idx: number) => (
                <details key={group.key} open={idx === 0} className="rounded-lg border border-neutral-800 bg-neutral-900/30 overflow-hidden">
                  <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between">
                    <span className="text-sm text-neutral-200">{humanizeKey(group.key)}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{group.entries.length} fields</Badge>
                      {group.fail > 0 ? <Badge variant="error">{group.fail} failing</Badge> : null}
                      {group.fail === 0 && group.pass > 0 ? <Badge variant="success">{group.pass} passing</Badge> : null}
                    </div>
                  </summary>
                  <div className="border-t border-neutral-800/70 max-h-64 overflow-auto divide-y divide-neutral-800/60">
                    {group.entries.map((entry: ScalarEntry) => {
                      const localPath = shortPath(entry.path, group.key);
                      const isBool = typeof entry.value === "boolean";
                      return (
                        <div key={entry.path} className="px-3 py-2 flex items-start justify-between gap-2">
                          <code className="text-[11px] text-neutral-400 break-all">{localPath}</code>
                          <div className="shrink-0">
                            {isBool ? (
                              <Badge variant={entry.value ? "success" : "error"}>{entry.value ? "true" : "false"}</Badge>
                            ) : (
                              <span className="text-xs text-neutral-200 font-mono">{formatScalarValue(entry)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* Raw payload */}
          <details className="rounded-lg border border-neutral-800 bg-neutral-900/30 overflow-hidden">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs text-neutral-400">
              Raw status payload
            </summary>
            <pre className="text-[11px] text-neutral-400 overflow-auto max-h-64 font-mono bg-neutral-900/40 rounded-b p-3">
              {JSON.stringify(statusData, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Gateway Info Panel
// ---------------------------------------------------------------------------

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={cn("text-xs text-neutral-200", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function GatewayInfoPanel({ hello }: { hello: NonNullable<ReturnType<typeof useGateway>["hello"]> }) {
  const [tab, setTab] = useState<"methods" | "events">("methods");
  const [search, setSearch] = useState("");
  const methods = hello.features?.methods ?? [];
  const events = hello.features?.events ?? [];
  const scopes = hello.auth?.scopes ?? [];
  const activeList = tab === "methods" ? methods : events;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) { return activeList; }
    return activeList.filter((item) => item.toLowerCase().includes(q));
  }, [activeList, search]);

  const snapshot = isRecord(hello.snapshot) ? hello.snapshot : null;
  const snapshotKeys = snapshot ? Object.keys(snapshot) : [];
  const snapshotPresenceCount = snapshot && Array.isArray(snapshot.presence) ? snapshot.presence.length : null;
  const hasSnapshotHealth = !!(snapshot && Object.prototype.hasOwnProperty.call(snapshot, "health"));

  return (
    <Card accent>
      <h2 className="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
        <Server size={16} className="text-primary-400" />
        Gateway Info
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryMetric label="Protocol" value={hello.protocol} prefix="v" icon={Server} tone="primary" />
        <SummaryMetric label="Methods" value={methods.length} icon={Activity} tone="info" />
        <SummaryMetric label="Events" value={events.length} icon={Zap} tone="warning" />
        <SummaryMetric label="Scopes" value={scopes.length} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Auth & Policy */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-neutral-500">Auth & Policy</h3>
          <InfoRow label="Role" value={hello.auth?.role ?? "unknown"} />
          <InfoRow label="Device Token" value={hello.auth?.deviceToken ? maskSecret(hello.auth.deviceToken) : "not set"} mono />
          <InfoRow
            label="Issued"
            value={typeof hello.auth?.issuedAtMs === "number" ? new Date(hello.auth.issuedAtMs).toLocaleString() : "n/a"}
          />
          <InfoRow
            label="Tick Interval"
            value={typeof hello.policy?.tickIntervalMs === "number" ? formatDurationMs(hello.policy.tickIntervalMs) : "n/a"}
          />
          <div>
            <p className="text-xs text-neutral-500 mb-2">Scopes</p>
            {scopes.length === 0 ? (
              <p className="text-xs text-neutral-500">No scopes reported.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {scopes.map((scope) => (
                  <Badge key={scope} variant="info">{scope}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Capability Explorer */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-neutral-500">Capability Explorer</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "px-2 py-1 text-xs rounded",
                tab === "methods" ? "bg-primary-500/20 text-primary-300" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
              )}
              onClick={() => setTab("methods")}
            >
              Methods ({methods.length})
            </button>
            <button
              type="button"
              className={cn(
                "px-2 py-1 text-xs rounded",
                tab === "events" ? "bg-primary-500/20 text-primary-300" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
              )}
              onClick={() => setTab("events")}
            >
              Events ({events.length})
            </button>
          </div>
          <div>
            <label className="text-xs text-neutral-400 flex items-center gap-2 mb-1">
              <Search size={12} />
              Filter capabilities
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab}...`}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div className="max-h-52 overflow-auto rounded-md border border-neutral-800/80 bg-neutral-900/40 p-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-neutral-500 px-1 py-2">No matching {tab}.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filtered.map((item) => (
                  <motion.span
                    key={item}
                    className="inline-flex items-center px-2 py-1 rounded text-xs border border-primary-500/20 bg-primary-500/10 text-primary-300"
                    whileHover={{ y: -1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 24 }}
                  >
                    {item}
                  </motion.span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Snapshot Coverage */}
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3">
        <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Snapshot Coverage</h3>
        {snapshot ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary">{snapshotKeys.length} sections</Badge>
              {snapshotPresenceCount != null && <Badge variant="success">presence: {snapshotPresenceCount}</Badge>}
              <Badge variant={hasSnapshotHealth ? "success" : "warning"}>
                health: {hasSnapshotHealth ? "present" : "missing"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {snapshotKeys.map((key) => (
                <Badge key={key} variant="default">{key}</Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">No snapshot payload in hello frame.</p>
        )}
      </div>

      {/* Raw hello */}
      <details className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/30 overflow-hidden">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs text-neutral-400">Raw hello payload</summary>
        <pre className="text-xs text-neutral-400 overflow-auto max-h-64 font-mono bg-neutral-900/40 rounded-b p-3">
          {JSON.stringify(hello, null, 2)}
        </pre>
      </details>
    </Card>
  );
}
