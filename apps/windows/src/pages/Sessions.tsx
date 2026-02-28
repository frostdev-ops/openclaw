import { useState } from "react";
import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { GatewaySessionRow } from "../gateway/types";

export function Sessions() {
  const { data, loading, error, refetch } = useGatewayRpc<{ sessions: GatewaySessionRow[] }>("sessions.list");
  const [search, setSearch] = useState("");

  const sessions = data?.sessions ?? [];
  const filtered = sessions.filter(
    (s) => !search || s.key.includes(search) || (s.label ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Sessions</div>
          <div className="page-sub">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}

      <div style={{ marginBottom: "12px" }}>
        <input
          className="input"
          placeholder="Filter sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "7px 12px",
            background: "var(--bg-input, var(--bg-secondary))",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
          }}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-head" style={{ gridTemplateColumns: "1fr 80px 80px 100px 120px" }}>
          <span>Session</span>
          <span>Kind</span>
          <span>Surface</span>
          <span>Model</span>
          <span>Updated</span>
        </div>
        {loading && <div className="muted" style={{ padding: "16px" }}>Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div className="muted" style={{ padding: "16px" }}>No sessions found</div>
        )}
        {filtered.map((s) => (
          <div key={s.key} className="table-row" style={{ gridTemplateColumns: "1fr 80px 80px 100px 120px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{s.label ?? s.key.slice(0, 16)}</div>
              <div className="mono muted">{s.key.slice(0, 20)}...</div>
            </div>
            <span className="pill muted">{s.kind ?? "chat"}</span>
            <span className="muted">{s.surface ?? "\u2014"}</span>
            <span className="mono muted" style={{ fontSize: "11px" }}>{s.model?.split("/").pop() ?? "\u2014"}</span>
            <span className="muted">{s.updatedAtMs ? new Date(s.updatedAtMs).toLocaleTimeString() : "\u2014"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
