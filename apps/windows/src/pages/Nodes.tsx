import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { NodeEntry } from "../gateway/types";

interface NodeListResult {
  nodes?: NodeEntry[];
}

export function Nodes() {
  const { data, loading, error, refetch } = useGatewayRpc<NodeListResult>("node.list");

  const nodes = data?.nodes ?? [];

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Nodes</div>
          <div className="page-sub">{nodes.length} node{nodes.length !== 1 ? "s" : ""} connected</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}
      {loading && <div className="muted">Loading nodes...</div>}

      {!loading && nodes.length === 0 && !error && (
        <div className="callout">No nodes connected</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {nodes.map((node) => (
          <div key={node.nodeId} className="card">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span className="statusDot ok" />
              <div style={{ fontWeight: 700, fontSize: "14px", flex: 1 }}>
                {node.displayName ?? node.nodeId}
              </div>
              {node.platform && <span className="pill muted">{node.platform}</span>}
              {node.version && <span className="mono muted" style={{ fontSize: "11px" }}>v{node.version}</span>}
            </div>
            <div className="mono muted" style={{ fontSize: "11px", marginBottom: "8px" }}>{node.nodeId}</div>
            {node.commands && node.commands.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {node.commands.slice(0, 8).map((cmd) => (
                  <span key={cmd} className="pill muted" style={{ fontSize: "10px" }}>{cmd}</span>
                ))}
                {node.commands.length > 8 && (
                  <span className="muted" style={{ fontSize: "11px" }}>+{node.commands.length - 8} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
