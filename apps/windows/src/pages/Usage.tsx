import { useState, useCallback, useMemo, useEffect } from "react";
import { useGateway } from "../gateway/context";
import type { SessionsUsageResult } from "../gateway/types";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/common/Button";
import { PageTransition } from "../components/motion/PageTransition";
import { FadeIn } from "../components/motion/FadeIn";
import { StaggerContainer, StaggerItem } from "../components/motion/StaggerContainer";
import { cn, formatTokens, formatCost } from "../lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  BarChart3,
  DollarSign,
  Coins,
  MessageSquare,
  Wrench,
  RefreshCw,
  TrendingUp,
  Cpu,
  Radio,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ---------------------------------------------------------------------------
// Chart theme
// ---------------------------------------------------------------------------

const CHART_COLORS = {
  primary: "#0ea5e9",
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
} as const;

const PIE_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.error,
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
] as const;

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#e4e4e7",
  fontSize: "12px",
} as const;

const GRID_STROKE = "#27272a";
const AXIS_TICK = "#71717a";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "overview" | "models" | "channels" | "tools";

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "models", label: "Models", icon: Cpu },
  { id: "channels", label: "Channels", icon: Radio },
  { id: "tools", label: "Tools", icon: Wrench },
];

// ---------------------------------------------------------------------------
// Simplified usage data shape (derived from sessions.usage RPC)
// ---------------------------------------------------------------------------

interface UsageTotals {
  totalCost: number;
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
}

interface UsageAggregates {
  totals: UsageTotals;
  messageTotal: number;
  toolCalls: number;
  daily: Array<{ date: string; tokens: number; cost: number }>;
  byModel: Array<{ model: string; provider: string; count: number; cost: number; tokens: number; input: number; output: number }>;
  byChannel: Array<{ channel: string; cost: number; tokens: number }>;
  tools: Array<{ name: string; count: number }>;
}

function deriveAggregates(data: SessionsUsageResult): UsageAggregates {
  const agg = data.aggregates;
  const cost = data.cost;

  const totalCost = agg?.totalCostUsd ?? cost?.totalCostUsd ?? 0;
  const totalTokens = agg?.totalTokens ?? 0;
  const totalInput = agg?.totalInputTokens ?? 0;
  const totalOutput = agg?.totalOutputTokens ?? 0;

  // Derive per-model breakdown from sessions
  const modelMap = new Map<string, { count: number; cost: number; tokens: number; input: number; output: number; provider: string }>();
  for (const s of data.sessions ?? []) {
    const model = s.model ?? "unknown";
    const existing = modelMap.get(model) ?? { count: 0, cost: 0, tokens: 0, input: 0, output: 0, provider: s.modelProvider ?? "unknown" };
    existing.count += 1;
    existing.tokens += s.totalTokens ?? 0;
    existing.input += s.inputTokens ?? 0;
    existing.output += s.outputTokens ?? 0;
    modelMap.set(model, existing);
  }

  // Distribute cost by model via cost.byModel if available
  if (cost?.byModel) {
    for (const [model, modelCost] of Object.entries(cost.byModel)) {
      const existing = modelMap.get(model);
      if (existing) {
        existing.cost = modelCost;
      }
    }
  }

  const byModel = [...modelMap.entries()].map(([model, v]) => ({
    model,
    provider: v.provider,
    count: v.count,
    cost: v.cost,
    tokens: v.tokens,
    input: v.input,
    output: v.output,
  }));

  // Derive per-channel breakdown from sessions
  const channelMap = new Map<string, { cost: number; tokens: number }>();
  for (const s of data.sessions ?? []) {
    const channel = s.lastChannel ?? s.surface ?? "unknown";
    const existing = channelMap.get(channel) ?? { cost: 0, tokens: 0 };
    existing.tokens += s.totalTokens ?? 0;
    channelMap.set(channel, existing);
  }

  if (cost?.byChannel) {
    for (const [channel, channelCost] of Object.entries(cost.byChannel)) {
      const existing = channelMap.get(channel);
      if (existing) {
        existing.cost = channelCost;
      }
    }
  }

  const byChannel = [...channelMap.entries()].map(([channel, v]) => ({
    channel,
    cost: v.cost,
    tokens: v.tokens,
  }));

  return {
    totals: { totalCost, totalTokens, totalInput, totalOutput },
    messageTotal: data.sessions?.length ?? 0,
    toolCalls: 0, // not directly available, but placeholder
    daily: [],
    byModel,
    byChannel,
    tools: [],
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCards({ totals, messageTotal, toolCalls }: { totals: UsageTotals; messageTotal: number; toolCalls: number }) {
  const cards: Array<{
    icon: React.ElementType;
    label: string;
    value: string;
    color: string;
    bgColor: string;
  }> = [
    {
      icon: DollarSign,
      label: "Total Cost",
      value: formatCost(totals.totalCost),
      color: "text-success-400",
      bgColor: "bg-gradient-to-br from-success-500/15 to-success-500/5",
    },
    {
      icon: Coins,
      label: "Total Tokens",
      value: formatTokens(totals.totalTokens),
      color: "text-primary-400",
      bgColor: "bg-gradient-to-br from-primary-500/15 to-primary-500/5",
    },
    {
      icon: MessageSquare,
      label: "Sessions",
      value: messageTotal.toLocaleString(),
      color: "text-warning-400",
      bgColor: "bg-gradient-to-br from-warning-500/15 to-warning-500/5",
    },
    {
      icon: Wrench,
      label: "Tool Calls",
      value: toolCalls.toLocaleString(),
      color: "text-info-400",
      bgColor: "bg-gradient-to-br from-info-500/15 to-info-500/5",
    },
  ];

  return (
    <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <StaggerItem key={card.label}>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-neutral-500 uppercase tracking-wider">{card.label}</p>
                  <p className="text-2xl font-semibold text-neutral-100 mt-1">{card.value}</p>
                </div>
                <div className={cn("p-2 rounded-lg", card.bgColor)}>
                  <Icon size={20} className={card.color} />
                </div>
              </div>
            </Card>
          </StaggerItem>
        );
      })}
    </StaggerContainer>
  );
}

function DailyChart({ daily }: { daily: Array<{ date: string; tokens: number; cost: number }> }) {
  const [metric, setMetric] = useState<"tokens" | "cost">("cost");

  if (daily.length === 0) {
    return (
      <Card accent>
        <EmptyState
          icon={BarChart3}
          title="No daily data"
          description="Daily usage data will appear once activity is recorded."
        />
      </Card>
    );
  }

  return (
    <Card accent>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-400" />
          Daily Usage
        </h2>
        <div className="flex gap-1">
          <button
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              metric === "cost" ? "bg-primary-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
            )}
            onClick={() => setMetric("cost")}
          >
            Cost
          </button>
          <button
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              metric === "tokens" ? "bg-primary-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
            )}
            onClick={() => setMetric("tokens")}
          >
            Tokens
          </button>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradientPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradientSuccess" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis
              dataKey="date"
              tick={{ fill: AXIS_TICK, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: GRID_STROKE }}
            />
            <YAxis
              tick={{ fill: AXIS_TICK, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                metric === "cost" ? `$${v.toFixed(2)}` : formatTokens(v)
              }
              width={60}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number | undefined) => {
                const v = value ?? 0;
                return metric === "cost" ? [formatCost(v), "Cost"] : [formatTokens(v), "Tokens"];
              }}
              labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
            />
            {metric === "cost" ? (
              <Area type="monotone" dataKey="cost" stroke={CHART_COLORS.success} fill="url(#gradientSuccess)" strokeWidth={2} />
            ) : (
              <Area type="monotone" dataKey="tokens" stroke={CHART_COLORS.primary} fill="url(#gradientPrimary)" strokeWidth={2} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ModelBreakdown({
  byModel,
}: {
  byModel: Array<{ model: string; provider: string; count: number; cost: number; tokens: number; input: number; output: number }>;
}) {
  const sorted = useMemo(
    () => [...byModel].toSorted((a, b) => b.cost - a.cost),
    [byModel],
  );

  if (sorted.length === 0) {
    return (
      <Card accent>
        <EmptyState icon={Cpu} title="No model data" description="Model usage breakdown will appear after requests are processed." />
      </Card>
    );
  }

  const chartData = sorted.map((entry) => ({
    name: entry.model,
    cost: entry.cost,
    tokens: entry.tokens,
    count: entry.count,
  }));

  return (
    <Card accent className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <Cpu size={16} className="text-primary-400" />
          Model Breakdown
        </h2>
      </div>

      {chartData.length > 1 && (
        <div className="px-4 pt-4 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="name" tick={{ fill: AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
              <YAxis tick={{ fill: AXIS_TICK, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={55} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number | undefined, name: string | undefined) => {
                  const v = value ?? 0;
                  if (name === "cost") { return [formatCost(v), "Cost"]; }
                  return [v.toLocaleString(), name ?? "value"];
                }}
                labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
              />
              <Bar dataKey="cost" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neutral-700/50 bg-neutral-900/30">
              <th className="px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Model</th>
              <th className="px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider">Provider</th>
              <th className="px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider text-right">Sessions</th>
              <th className="px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider text-right">Tokens</th>
              <th className="px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase tracking-wider text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => (
              <tr key={`${entry.provider}-${entry.model}-${i}`} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                <td className="px-4 py-2.5">
                  <span className="text-sm text-neutral-200 font-mono">{entry.model}</span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant="info">{entry.provider}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className="text-sm text-neutral-300">{entry.count.toLocaleString()}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-neutral-200">{formatTokens(entry.tokens)}</span>
                    <span className="text-[10px] text-neutral-500">
                      {formatTokens(entry.input)} in / {formatTokens(entry.output)} out
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className="text-sm text-success-400 font-medium">{formatCost(entry.cost)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ChannelBreakdown({ byChannel }: { byChannel: Array<{ channel: string; cost: number; tokens: number }> }) {
  const sorted = useMemo(
    () => [...byChannel].toSorted((a, b) => b.cost - a.cost),
    [byChannel],
  );

  if (sorted.length === 0) {
    return (
      <Card accent>
        <EmptyState icon={PieChartIcon} title="No channel data" description="Channel usage data will appear after activity is recorded." />
      </Card>
    );
  }

  const pieData = sorted.map((entry) => ({ name: entry.channel, value: entry.cost }));

  return (
    <Card accent>
      <h2 className="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
        <Radio size={16} className="text-primary-400" />
        Channel Breakdown
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-64 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value">
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_PALETTE[index % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number | undefined) => [formatCost(value ?? 0), "Cost"]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-2">
          {sorted.map((entry, i) => {
            const color = PIE_PALETTE[i % PIE_PALETTE.length];
            return (
              <div key={entry.channel} className="flex items-center justify-between py-2 px-3 rounded-md bg-neutral-900/50 hover:bg-neutral-800/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-sm text-neutral-200">{entry.channel}</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="text-xs text-neutral-400">{formatTokens(entry.tokens)}</span>
                  <span className="text-sm text-success-400 font-medium min-w-[64px]">{formatCost(entry.cost)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ToolsList({ tools }: { tools: Array<{ name: string; count: number }> }) {
  const sorted = useMemo(
    () => [...tools].toSorted((a, b) => b.count - a.count),
    [tools],
  );

  if (sorted.length === 0) {
    return (
      <Card>
        <EmptyState icon={Wrench} title="No tool usage" description="Tool call data will appear after tools are invoked." />
      </Card>
    );
  }

  const maxCount = sorted[0]?.count ?? 1;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
        <Wrench size={16} className="text-warning-400" />
        Top Tools
        <Badge variant="default">{sorted.length} tools</Badge>
      </h2>

      <div className="space-y-2">
        {sorted.map((tool) => {
          const pct = maxCount > 0 ? (tool.count / maxCount) * 100 : 0;
          return (
            <div key={tool.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-neutral-300 font-mono truncate max-w-[240px]">{tool.name}</span>
                <span className="text-xs text-neutral-400 tabular-nums">{tool.count.toLocaleString()}</span>
              </div>
              <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-warning-500/70 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Usage (main export)
// ---------------------------------------------------------------------------

export function Usage() {
  const { rpc, status: gwStatus } = useGateway();
  const connected = gwStatus.state === "connected";

  const [usageData, setUsageData] = useState<SessionsUsageResult | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const fetchUsage = useCallback(async () => {
    if (!connected) { return; }

    // Try sessions.usage first, fall back to usage.status
    const res = await rpc<SessionsUsageResult>("sessions.usage", {});
    if (res.ok && res.payload) {
      setUsageData(res.payload);
      setUsageError(null);
      return;
    }

    // Fallback
    const fallback = await rpc<SessionsUsageResult>("usage.status", {});
    if (fallback.ok && fallback.payload) {
      setUsageData(fallback.payload);
      setUsageError(null);
    } else {
      setUsageError(fallback.error?.message ?? "Failed to load usage data");
    }
  }, [connected, rpc]);

  useEffect(() => {
    if (!connected) { return; }
    setUsageLoading(true);
    void fetchUsage().finally(() => setUsageLoading(false));
  }, [connected, fetchUsage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsage();
    setRefreshing(false);
  }, [fetchUsage]);

  const agg = useMemo<UsageAggregates | null>(() => {
    if (!usageData) { return null; }
    return deriveAggregates(usageData);
  }, [usageData]);

  return (
    <PageTransition>
      <div className="space-y-6">
        <FadeIn>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-neutral-100">Usage</h1>
              <p className="text-sm text-neutral-400 mt-1">
                Token consumption, cost breakdown, and activity analytics.
              </p>
            </div>
            <Button onClick={() => void handleRefresh()} loading={refreshing} variant="secondary">
              <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </FadeIn>

        {usageLoading && !usageData ? (
          <div className="flex justify-center py-16"><Spinner size={28} /></div>
        ) : usageError ? (
          <Card>
            <div className="text-center py-8">
              <p className="text-sm text-error-400">{usageError}</p>
              <Button variant="secondary" className="mt-3" onClick={() => void handleRefresh()}>Retry</Button>
            </div>
          </Card>
        ) : !agg ? (
          <EmptyState icon={BarChart3} title="No usage data" description="Usage analytics will appear once sessions have activity." />
        ) : (
          <>
            <SummaryCards totals={agg.totals} messageTotal={agg.messageTotal} toolCalls={agg.toolCalls} />

            {/* Tab navigation */}
            <div className="flex items-center gap-1 border-b border-neutral-800 overflow-x-auto">
              {TABS.map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                      activeTab === tab.id
                        ? "border-primary-500 text-primary-400"
                        : "border-transparent text-neutral-500 hover:text-neutral-300 hover:border-neutral-600",
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <TabIcon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === "overview" && (
                  <div className="space-y-6">
                    <DailyChart daily={agg.daily} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <ModelBreakdown byModel={agg.byModel} />
                      <ChannelBreakdown byChannel={agg.byChannel} />
                    </div>
                  </div>
                )}
                {activeTab === "models" && <ModelBreakdown byModel={agg.byModel} />}
                {activeTab === "channels" && <ChannelBreakdown byChannel={agg.byChannel} />}
                {activeTab === "tools" && <ToolsList tools={agg.tools} />}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </PageTransition>
  );
}
