import { useGateway } from "../gateway/context";
import { useGatewayRpc } from "../hooks/useGatewayRpc";
import { startNode, stopNode } from "../tauri/commands";
import type { NodeStatusString } from "../tauri/types";

interface OverviewProps {
  status: NodeStatusString;
  onStatusChange: (s: NodeStatusString) => void;
  onNavigateToLogs: () => void;
}

export function Overview({ status, onStatusChange, onNavigateToLogs }: OverviewProps) {
  const { status: gwStatus, hello } = useGateway();
  const connected = gwStatus.state === "connected";

  // Fetch health snapshot
  const { data: health } = useGatewayRpc<{ passing: number; failing: number; signals: unknown[] }>("health");

  const handleStart = async () => {
    try { onStatusChange("starting"); await startNode(); } catch { onStatusChange("error"); }
  };
  const handleStop = async () => {
    try { await stopNode(); onStatusChange("stopped"); } catch { onStatusChange("error"); }
  };

  const presenceCount = hello?.snapshot?.presence?.length ?? 0;
  const methodCount = hello?.features?.methods?.length ?? 0;

  return (
    <div>
      <div className="content-header">
        <div className="page-title">Overview</div>
        <div className="page-sub">Gateway control surface</div>
      </div>

      {/* Stat row */}
      <div className="grid-4" style={{ marginBottom: "16px" }}>
        <div className="stat-card">
          <div className="stat-label">Protocol</div>
          <div className="stat-value">{connected ? `v${gwStatus.protocol ?? "?"}` : "\u2014"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Presence</div>
          <div className="stat-value">{connected ? presenceCount : "\u2014"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Methods</div>
          <div className="stat-value">{connected ? methodCount : "\u2014"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Node Status</div>
          <div className="stat-value" style={{ fontSize: "14px" }}>
            <span className={`pill ${status === "running" ? "ok" : status === "error" ? "danger" : "muted"}`}>
              <span className={`statusDot ${status === "running" ? "ok" : status === "error" ? "danger" : "muted"}`} />
              {status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: "16px" }}>
        {/* Node control */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "12px", fontSize: "13px" }}>Node Control</div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <button
              className="btn btn-primary"
              disabled={status === "running" || status === "starting"}
              onClick={() => void handleStart()}
            >
              Start
            </button>
            <button
              className="btn btn-ghost"
              disabled={status === "stopped"}
              onClick={() => void handleStop()}
            >
              Stop
            </button>
            <button
              className="btn btn-ghost"
              onClick={onNavigateToLogs}
              style={{ marginLeft: "auto" }}
            >
              View Logs
            </button>
          </div>
          {gwStatus.state === "connected" && gwStatus.serverVersion && (
            <div className="muted">Gateway {gwStatus.serverVersion} · conn {gwStatus.connId?.slice(0, 8)}</div>
          )}
          {gwStatus.state === "disconnected" && (
            <div className="callout">Gateway disconnected — start the node to reconnect</div>
          )}
          {gwStatus.state === "error" && (
            <div className="callout danger">{gwStatus.error ?? "Connection error"}</div>
          )}
        </div>

        {/* Health summary */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "12px", fontSize: "13px" }}>Health</div>
          {!connected && <div className="muted">Connect to gateway to view health</div>}
          {connected && health && (
            <div className="grid-2" style={{ gap: "8px" }}>
              <div className="stat-card" style={{ animation: "none" }}>
                <div className="stat-label">Passing</div>
                <div className="stat-value" style={{ color: "var(--ok)" }}>{health.passing}</div>
              </div>
              <div className="stat-card" style={{ animation: "none" }}>
                <div className="stat-label">Failing</div>
                <div className="stat-value" style={{ color: health.failing > 0 ? "var(--danger)" : "var(--text-strong)" }}>
                  {health.failing}
                </div>
              </div>
            </div>
          )}
          {connected && !health && <div className="muted">Loading health data...</div>}
        </div>
      </div>

      {/* Presence list */}
      {connected && hello?.snapshot?.presence && hello.snapshot.presence.length > 0 && (
        <div className="card" style={{ marginTop: "16px" }}>
          <div style={{ fontWeight: 700, marginBottom: "12px", fontSize: "13px" }}>Connected Instances</div>
          {hello.snapshot.presence.map((entry, i) => (
            <div key={i} className="list-item">
              <span className="statusDot ok" />
              <span style={{ flex: 1, fontSize: "13px" }}>{entry.displayName ?? entry.clientId ?? "unknown"}</span>
              <span className="pill muted">{entry.mode ?? "client"}</span>
              {entry.platform && <span className="muted mono">{entry.platform}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
