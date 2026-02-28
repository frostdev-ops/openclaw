import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../components/ui/Button";
import { getStatus, gatewayRpc } from "../tauri/commands";
import { onNodeLog } from "../tauri/events";
import { useGateway } from "../gateway/context";

const LOG_CAP = 300;

type LogFilter = "stdout" | "stderr" | "ui";
type LogTab = "node" | "gateway";

interface GatewayLogEntry {
  level: string;
  ts: number;
  subsystem?: string;
  msg: string;
}

interface LogsTailResult {
  entries?: GatewayLogEntry[];
  cursor?: number;
}

export function Logs() {
  const [tab, setTab] = useState<LogTab>("node");
  const [lines, setLines] = useState<string[]>([]);
  const [gatewayLines, setGatewayLines] = useState<GatewayLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filters, setFilters] = useState<Set<LogFilter>>(new Set(["stdout", "stderr", "ui"]));
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(["trace", "debug", "info", "warn", "error", "fatal"]));
  const [pairingDismissed, setPairingDismissed] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [gwLoading, setGwLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const cursorRef = useRef<number | undefined>(undefined);
  const { status: gwStatus } = useGateway();

  const checkPairing = useCallback((line: string) => {
    if (pairingDismissed) { return; }
    const lower = line.toLowerCase();
    if (lower.includes("pending") && lower.includes("pair")) {
      setShowPairing(true);
    }
  }, [pairingDismissed]);

  useEffect(() => {
    // Load initial logs from status
    void getStatus().then((s) => {
      const initial = s.logs ?? [];
      setLines(initial.slice(-LOG_CAP));
    }).catch(() => {});

    void onNodeLog((line) => {
      setLines((prev) => {
        const next = [...prev, line].slice(-LOG_CAP);
        return next;
      });
      checkPairing(line);
    }).then((fn) => { unlistenRef.current = fn; });

    return () => {
      unlistenRef.current?.();
    };
  }, [checkPairing]);

  // Fetch gateway logs when gateway tab is active
  useEffect(() => {
    if (tab !== "gateway" || gwStatus.state !== "connected") { return; }
    setGwLoading(true);
    cursorRef.current = undefined;
    void gatewayRpc<LogsTailResult>("logs.tail", { limit: 200 }).then((res) => {
      const payload = res?.payload;
      if (payload?.entries) { setGatewayLines(payload.entries.slice(-LOG_CAP)); }
      if (payload?.cursor != null) { cursorRef.current = payload.cursor; }
    }).catch(() => {}).finally(() => setGwLoading(false));
  }, [tab, gwStatus.state]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, gatewayLines, autoScroll]);

  const toggleFilter = (f: LogFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) { next.delete(f); } else { next.add(f); }
      return next;
    });
  };

  const toggleLevel = (l: string) => {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(l)) { next.delete(l); } else { next.add(l); }
      return next;
    });
  };

  const filteredLines = lines.filter((line) => {
    if (line.startsWith("[stdout]") && !filters.has("stdout")) { return false; }
    if (line.startsWith("[stderr]") && !filters.has("stderr")) { return false; }
    if (line.startsWith("[ui]") && !filters.has("ui")) { return false; }
    return true;
  });

  const filteredGwLines = gatewayLines.filter((e) => levelFilter.has(e.level));

  function lineColor(line: string): string {
    if (line.startsWith("[stdout]")) { return "var(--log-stdout)"; }
    if (line.startsWith("[stderr]")) { return "var(--log-stderr)"; }
    if (line.startsWith("[ui]")) { return "var(--log-ui)"; }
    return "var(--text-secondary)";
  }

  function lineStyle(line: string): React.CSSProperties {
    const color = lineColor(line);
    const isUi = line.startsWith("[ui]");
    return { color, fontStyle: isUi ? "italic" : "normal" };
  }

  function levelColor(level: string): string {
    if (level === "error" || level === "fatal") { return "var(--log-stderr)"; }
    if (level === "warn") { return "#f59e0b"; }
    if (level === "debug" || level === "trace") { return "var(--text-muted)"; }
    return "var(--log-stdout)";
  }

  function formatGwLine(e: GatewayLogEntry): string {
    const ts = new Date(e.ts).toISOString().slice(11, 23);
    const sub = e.subsystem ? ` [${e.subsystem}]` : "";
    return `${ts}${sub} ${e.msg}`;
  }

  const ALL_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%", maxWidth: "900px" }}>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
        {(["node", "gateway"] as LogTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? "var(--bg-elevated)" : "none",
              border: tab === t ? "1px solid var(--border-subtle)" : "1px solid transparent",
              borderRadius: "var(--radius-sm)",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 10px",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === "node" ? "Node Logs" : "Gateway Logs"}
            {t === "gateway" && gwStatus.state !== "connected" && (
              <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-muted)" }}>(offline)</span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <Button variant="ghost" size="sm" onClick={() => { if (tab === "node") { setLines([]); } else { setGatewayLines([]); } }}>
          Clear
        </Button>
        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
          Auto-scroll
        </label>
        <span style={{ color: "var(--border-subtle)" }}>|</span>
        {tab === "node" && (
          <>
            {(["stdout", "stderr", "ui"] as LogFilter[]).map((f) => (
              <label key={f} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", cursor: "pointer", color: filters.has(f) ? lineColor(`[${f}]`) : "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={filters.has(f)}
                  onChange={() => toggleFilter(f)}
                  style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                />
                {f}
              </label>
            ))}
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>
              {filteredLines.length} / {lines.length} lines
            </span>
          </>
        )}
        {tab === "gateway" && (
          <>
            {ALL_LEVELS.map((l) => (
              <label key={l} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", cursor: "pointer", color: levelFilter.has(l) ? levelColor(l) : "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={levelFilter.has(l)}
                  onChange={() => toggleLevel(l)}
                  style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                />
                {l}
              </label>
            ))}
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>
              {filteredGwLines.length} / {gatewayLines.length} lines
            </span>
          </>
        )}
      </div>

      {/* Pairing callout */}
      <AnimatePresence>
        {tab === "node" && showPairing && !pairingDismissed && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              background: "rgba(15,118,110,0.12)",
              border: "1px solid rgba(15,118,110,0.3)",
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "13px",
              color: "var(--accent-light)",
            }}
          >
            <span>🔗</span>
            <span style={{ flex: 1 }}>A pairing request is pending. Check your mobile device to approve.</span>
            <button
              onClick={() => { setPairingDismissed(true); setShowPairing(false); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "16px", padding: 0, lineHeight: 1 }}
            >×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log terminal */}
      <div
        style={{
          flex: 1,
          background: "var(--log-bg)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-subtle)",
          overflow: "auto",
          padding: "12px",
          minHeight: "300px",
        }}
      >
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: 1.6,
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {tab === "node" && (
            <>
              {filteredLines.map((line, i) => (
                <span key={i} style={lineStyle(line)}>
                  {line}{"\n"}
                </span>
              ))}
              {filteredLines.length === 0 && (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  No log output yet...
                </span>
              )}
            </>
          )}
          {tab === "gateway" && (
            <>
              {gwLoading && (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Loading gateway logs...</span>
              )}
              {!gwLoading && gwStatus.state !== "connected" && (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  Connect to gateway to view logs.
                </span>
              )}
              {!gwLoading && gwStatus.state === "connected" && filteredGwLines.map((e, i) => (
                <span key={i} style={{ color: levelColor(e.level) }}>
                  {formatGwLine(e)}{"\n"}
                </span>
              ))}
              {!gwLoading && gwStatus.state === "connected" && filteredGwLines.length === 0 && (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  No gateway log entries.
                </span>
              )}
            </>
          )}
        </pre>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
