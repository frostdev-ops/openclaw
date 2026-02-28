import { useGatewayRpc } from "../hooks/useGatewayRpc";

interface UsageStatus {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  byModel?: Record<string, { inputTokens: number; outputTokens: number; estimatedCostUsd?: number }>;
}

function formatTokens(n: number | undefined): string {
  if (n == null) { return "\u2014"; }
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}K`; }
  return String(n);
}

export function Usage() {
  const { data: usageStatus, loading: statusLoading, refetch } = useGatewayRpc<UsageStatus>("usage.status");

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Usage</div>
          <div className="page-sub">Token usage and cost tracking</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={statusLoading}>Refresh</button>
      </div>

      <div className="grid-4" style={{ marginBottom: "16px" }}>
        <div className="stat-card">
          <div className="stat-label">Input Tokens</div>
          <div className="stat-value">{formatTokens(usageStatus?.totalInputTokens)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Output Tokens</div>
          <div className="stat-value">{formatTokens(usageStatus?.totalOutputTokens)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value">{formatTokens(usageStatus?.totalTokens)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Est. Cost (USD)</div>
          <div className="stat-value">
            {usageStatus?.estimatedCostUsd != null
              ? `$${usageStatus.estimatedCostUsd.toFixed(4)}`
              : "\u2014"}
          </div>
        </div>
      </div>

      {usageStatus?.byModel && Object.keys(usageStatus.byModel).length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "12px", fontSize: "13px" }}>By Model</div>
          <div className="table-head" style={{ gridTemplateColumns: "1fr 100px 100px 100px" }}>
            <span>Model</span>
            <span>Input</span>
            <span>Output</span>
            <span>Cost</span>
          </div>
          {Object.entries(usageStatus.byModel).map(([model, stats]) => (
            <div key={model} className="table-row" style={{ gridTemplateColumns: "1fr 100px 100px 100px" }}>
              <span className="mono" style={{ fontSize: "12px" }}>{model}</span>
              <span className="muted">{formatTokens(stats.inputTokens)}</span>
              <span className="muted">{formatTokens(stats.outputTokens)}</span>
              <span className="muted">{stats.estimatedCostUsd != null ? `$${stats.estimatedCostUsd.toFixed(4)}` : "\u2014"}</span>
            </div>
          ))}
        </div>
      )}
      {statusLoading && <div className="muted">Loading usage data...</div>}
      {!statusLoading && !usageStatus && <div className="muted">Connect to gateway to view usage</div>}
    </div>
  );
}
