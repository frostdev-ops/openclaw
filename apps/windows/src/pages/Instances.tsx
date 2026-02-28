import { useGateway } from "../gateway/context";
import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { PresenceEntry } from "../gateway/types";

interface NetworkNode extends PresenceEntry {
  nodeId?: string;
}

function timeSince(ms?: number): string {
  if (!ms) { return "—"; }
  const diff = Date.now() - ms;
  if (diff < 60000) { return `${Math.round(diff / 1000)}s ago`; }
  if (diff < 3600000) { return `${Math.round(diff / 60000)}m ago`; }
  return `${Math.round(diff / 3600000)}h ago`;
}

export function Instances() {
  const { hello } = useGateway();
  const { data: networkData, loading, refetch } = useGatewayRpc<{ nodes: NetworkNode[]; nodeCount: number }>("network.connections");

  // Get presence from hello snapshot
  const presence = hello?.snapshot?.presence ?? [];

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Instances</div>
          <div className="page-sub">{presence.length} connected instance{presence.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {presence.length === 0 && (
        <div className="callout">No instances connected</div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {presence.length > 0 && (
          <>
            <div className="table-head" style={{ gridTemplateColumns: "1fr 80px 80px 100px 100px" }}>
              <span>Instance</span>
              <span>Mode</span>
              <span>Platform</span>
              <span>Version</span>
              <span>Connected</span>
            </div>
            {presence.map((entry, i) => (
              <div key={i} className="table-row" style={{ gridTemplateColumns: "1fr 80px 80px 100px 100px" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13px" }}>{entry.displayName ?? entry.clientId ?? "Unknown"}</div>
                  <div className="mono muted">{entry.connId?.slice(0, 12) ?? "—"}</div>
                </div>
                <span className={`pill ${entry.mode === "node" ? "ok" : entry.mode === "control" ? "warn" : "muted"}`}>
                  {entry.mode ?? "client"}
                </span>
                <span className="muted">{entry.platform ?? "—"}</span>
                <span className="mono muted" style={{ fontSize: "11px" }}>{entry.version ?? "—"}</span>
                <span className="muted">{timeSince(entry.connectedAtMs)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Network connections from new endpoint */}
      {networkData?.nodes && networkData.nodes.length > 0 && (
        <div className="card" style={{ marginTop: "16px" }}>
          <div style={{ fontWeight: 700, marginBottom: "12px", fontSize: "13px" }}>Connected Nodes ({networkData.nodeCount})</div>
          {networkData.nodes.map((node, i) => (
            <div key={i} className="list-item">
              <span className="statusDot ok" />
              <span style={{ flex: 1, fontSize: "13px" }}>{node.nodeId ?? `Node ${i + 1}`}</span>
              {node.platform && (
                <span className="muted">{node.platform}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
