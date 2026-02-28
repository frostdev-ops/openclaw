import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { GatewayAgentRow } from "../gateway/types";

export function Agents() {
  const { data, loading, error, refetch } = useGatewayRpc<{ agents: GatewayAgentRow[] }>("agents.list");

  const agents = data?.agents ?? [];

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Agents</div>
          <div className="page-sub">{agents.length} agent{agents.length !== 1 ? "s" : ""} configured</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}
      {loading && <div className="muted">Loading agents...</div>}
      {!loading && agents.length === 0 && !error && (
        <div className="callout">No agents configured</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {agents.map((agent) => (
          <div key={agent.agentId} className="card list-item" style={{ padding: "12px 16px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "15px", color: "var(--accent-light)", flexShrink: 0 }}>
              {(agent.displayName ?? agent.name ?? agent.agentId).charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>{agent.displayName ?? agent.name ?? agent.agentId}</div>
              {agent.description && <div className="muted">{agent.description}</div>}
            </div>
            {agent.isDefault && <span className="pill ok">Default</span>}
            <span className="mono muted" style={{ fontSize: "11px" }}>{agent.agentId.slice(0, 12)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
