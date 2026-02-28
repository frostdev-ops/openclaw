import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { ChannelsStatusSnapshot } from "../gateway/types";

export function Channels() {
  const { data, loading, error, refetch } = useGatewayRpc<ChannelsStatusSnapshot>("channels.status");

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Channels</div>
          <div className="page-sub">Messaging channel status</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}
      {!data && !loading && !error && <div className="muted">Connect to gateway to view channels</div>}
      {loading && <div className="muted">Loading channels...</div>}

      {data?.channels && data.channels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {data.channels.map((ch) => (
            <div key={ch.channelId} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px" }}>{ch.channelId}</div>
                <span className={`pill ${ch.configured ? "ok" : "muted"}`}>
                  <span className={`statusDot ${ch.configured ? "ok" : "muted"}`} />
                  {ch.configured ? "Configured" : "Not configured"}
                </span>
              </div>
              {ch.error && <div className="callout danger">{ch.error}</div>}
              {ch.accounts && ch.accounts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {ch.accounts.map((acc, i) => (
                    <div key={i} className="list-item">
                      <span className={`statusDot ${acc.connected ? "ok" : acc.running ? "warn" : "muted"}`} />
                      <span style={{ fontSize: "12px", flex: 1 }}>{acc.accountId ?? `Account ${i + 1}`}</span>
                      {acc.connected && <span className="pill ok">Connected</span>}
                      {!acc.connected && acc.running && <span className="pill warn">Running</span>}
                      {!acc.running && <span className="pill muted">Stopped</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data?.channels && data.channels.length === 0 && (
        <div className="callout">No channels configured</div>
      )}
    </div>
  );
}
