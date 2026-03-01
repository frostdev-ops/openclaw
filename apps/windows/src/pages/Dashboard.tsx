import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useUptime } from "../hooks/useUptime";
import type { NodeStatusString } from "../tauri/types";
import { getStatus, startNode, stopNode, restartNode } from "../tauri/commands";

interface DashboardProps {
  status: NodeStatusString;
  onStatusChange: (s: NodeStatusString) => void;
  onNavigateToLogs: () => void;
}

export function Dashboard({ status, onStatusChange, onNavigateToLogs }: DashboardProps) {
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const uptime = useUptime(status === "running");

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus();
      const st: NodeStatusString = s.status ?? (s.running ? "running" : "stopped");
      onStatusChange(st);
      setGatewayUrl(s.gatewayUrl || "");
      if (s.lastError && s.lastError !== lastError) {
        setLastError(s.lastError);
        setErrorDismissed(false);
      }
    } catch { /* silent */ }
  }, [lastError, onStatusChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runCmd(cmd: string, fn: () => Promise<void>) {
    setLoading(cmd);
    try { await fn(); } catch { /* silent */ }
    await refresh();
    setLoading(null);
  }

  const copyUrl = async () => {
    if (!gatewayUrl) { return; }
    await navigator.clipboard.writeText(gatewayUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "680px" }}>
      {/* Status card */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
          <StatusBadge status={status} />
          {uptime && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Uptime: {uptime}</span>
          )}
        </div>
        {/* Gateway URL */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Gateway URL
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              readOnly
              value={gatewayUrl || "—"}
              style={{
                flex: 1,
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                padding: "6px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                outline: "none",
              }}
            />
            <Button variant="ghost" size="sm" onClick={copyUrl} disabled={!gatewayUrl}>
              {copied ? "✓ Copied" : "Copy"}
            </Button>
          </div>
        </div>
        {/* Control buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button
            variant="success"
            size="sm"
            onClick={() => runCmd("start", startNode)}
            disabled={!!loading || status === "running" || status === "starting"}
          >
            {loading === "start" ? "Starting…" : "▶ Start"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => runCmd("stop", stopNode)}
            disabled={!!loading || status === "stopped"}
          >
            {loading === "stop" ? "Stopping…" : "■ Stop"}
          </Button>
          <Button
            variant="warning"
            size="sm"
            onClick={() => runCmd("restart", restartNode)}
            disabled={!!loading}
          >
            {loading === "restart" ? "Restarting…" : "↺ Restart"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={!!loading}
          >
            ⟳ Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigateToLogs}
          >
            📋 Logs
          </Button>
        </div>
      </Card>

      {/* Error banner */}
      <AnimatePresence>
        {lastError && !errorDismissed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--radius-md)",
              padding: "12px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
            }}
          >
            <span style={{ color: "#ef4444", fontSize: "14px", flexShrink: 0 }}>⚠</span>
            <span style={{ flex: 1, color: "var(--text-primary)", fontSize: "13px" }}>{lastError}</span>
            <button
              onClick={() => setErrorDismissed(true)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
                flexShrink: 0,
                padding: 0,
              }}
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
