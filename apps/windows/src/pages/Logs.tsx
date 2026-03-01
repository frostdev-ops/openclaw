import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { EmptyState } from "../components/common/EmptyState";
import { PageTransition } from "../components/motion/PageTransition";
import { FadeIn } from "../components/motion/FadeIn";
import { getStatus } from "../tauri/commands";
import { onNodeLog } from "../tauri/events";
import { useGateway } from "../gateway/context";
import { cn } from "../lib/utils";
import {
  Play,
  Pause,
  Trash2,
  ArrowDown,
  ScrollText,
  Search,
  Filter,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_LOG_CAP = 300;
const GW_LOG_CAP = 2000;
const GW_POLL_INTERVAL = 2000;

type LogFilter = "stdout" | "stderr" | "ui";
type LogTab = "node" | "gateway";
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const ALL_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

// ---------------------------------------------------------------------------
// Gateway log types
// ---------------------------------------------------------------------------

interface GatewayLogEntry {
  time?: string;
  level: LogLevel | null;
  subsystem: string | null;
  message: string;
  raw: string;
}

interface LogsTailResult {
  entries?: Array<{ level?: string; ts?: number; subsystem?: string; msg?: string }>;
  lines?: unknown;
  cursor?: number;
  reset?: boolean;
}

// ---------------------------------------------------------------------------
// Level colors
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: "text-neutral-500",
  debug: "text-neutral-400",
  info: "text-sky-400",
  warn: "text-warning-400",
  error: "text-error-400",
  fatal: "text-error-300",
};

const LEVEL_BG: Record<LogLevel, string> = {
  trace: "bg-neutral-800 text-neutral-400",
  debug: "bg-neutral-800 text-neutral-300",
  info: "bg-sky-500/10 text-sky-400",
  warn: "bg-warning-500/10 text-warning-400",
  error: "bg-error-500/10 text-error-400",
  fatal: "bg-error-500/20 text-error-300",
};

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

const LOG_LEVEL_SET = new Set<LogLevel>(ALL_LEVELS);

function normalizeLevel(value: unknown): LogLevel | null {
  if (typeof value !== "string") { return null; }
  const lowered = value.toLowerCase() as LogLevel;
  return LOG_LEVEL_SET.has(lowered) ? lowered : null;
}

function parseLogLine(line: string): GatewayLogEntry {
  if (!line.trim()) {
    return { raw: line, message: line, level: null, subsystem: null };
  }

  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const meta = obj && typeof obj._meta === "object" && obj._meta !== null
      ? (obj._meta as Record<string, unknown>)
      : null;

    const time = typeof obj.time === "string"
      ? obj.time
      : typeof meta?.date === "string"
        ? meta.date
        : null;

    const level = normalizeLevel(meta?.logLevelName ?? meta?.level ?? obj.level);

    let subsystem: string | null = null;
    const nameField = typeof obj["0"] === "string" ? obj["0"] : typeof meta?.name === "string" ? meta.name : null;
    if (nameField && nameField.length < 120) {
      // Try to parse as JSON for subsystem field
      try {
        const parsed = JSON.parse(nameField) as Record<string, unknown>;
        subsystem = (typeof parsed.subsystem === "string" ? parsed.subsystem : typeof parsed.module === "string" ? parsed.module : nameField);
      } catch {
        subsystem = nameField;
      }
    }

    let message: string | null = null;
    if (typeof obj["1"] === "string") {
      message = obj["1"];
    } else if (typeof obj.message === "string") {
      message = obj.message;
    } else if (typeof obj.msg === "string") {
      message = obj.msg;
    }

    return {
      raw: line,
      time: time ?? undefined,
      level,
      subsystem,
      message: message ?? line,
    };
  } catch {
    // Structured entry (from entries array)
    return { raw: line, message: line, level: null, subsystem: null };
  }
}

function parseStructuredEntry(entry: { level?: string; ts?: number; subsystem?: string; msg?: string }): GatewayLogEntry {
  const level = normalizeLevel(entry.level);
  const time = entry.ts ? new Date(entry.ts).toISOString() : undefined;
  return {
    raw: JSON.stringify(entry),
    time,
    level,
    subsystem: entry.subsystem ?? null,
    message: entry.msg ?? "",
  };
}

// ---------------------------------------------------------------------------
// Node log helpers
// ---------------------------------------------------------------------------

function nodeLineColor(line: string): string {
  if (line.startsWith("[stdout]")) { return "var(--color-sky-400, #38bdf8)"; }
  if (line.startsWith("[stderr]")) { return "var(--color-error-400, #f87171)"; }
  if (line.startsWith("[ui]")) { return "var(--color-neutral-400, #a1a1aa)"; }
  return "var(--color-neutral-500, #71717a)";
}

// ---------------------------------------------------------------------------
// Logs component
// ---------------------------------------------------------------------------

export function Logs() {
  const [tab, setTab] = useState<LogTab>("node");
  const { status: gwStatus, rpc } = useGateway();
  const connected = gwStatus.state === "connected";

  // ---- Node logs state ----
  const [nodeLines, setNodeLines] = useState<string[]>([]);
  const [nodeFilters, setNodeFilters] = useState<Set<LogFilter>>(new Set(["stdout", "stderr", "ui"]));
  const [pairingDismissed, setPairingDismissed] = useState(false);
  const [showPairing, setShowPairing] = useState(false);

  // ---- Gateway logs state ----
  const [gwEntries, setGwEntries] = useState<GatewayLogEntry[]>([]);
  const [gwTailing, setGwTailing] = useState(true);
  const [gwLevelFilter, setGwLevelFilter] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [gwSubsystemFilter, setGwSubsystemFilter] = useState("");
  const [gwSearchText, setGwSearchText] = useState("");
  const gwCursorRef = useRef<number | undefined>(undefined);

  // ---- Shared scroll state ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const isNearBottom = useRef(true);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) { return; }
    const el = scrollRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isNearBottom.current = atBottom;
    if (atBottom) {
      setUnseenCount(0);
    }
  }, []);

  // Auto-scroll when new content arrives
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUnseenCount(0);
    }
  }, []);

  // ---- Node logs setup ----
  const unlistenRef = useRef<(() => void) | null>(null);

  const checkPairing = useCallback((line: string) => {
    if (pairingDismissed) { return; }
    const lower = line.toLowerCase();
    if (lower.includes("pending") && lower.includes("pair")) {
      setShowPairing(true);
    }
  }, [pairingDismissed]);

  useEffect(() => {
    void getStatus().then((s) => {
      const initial = s.logs ?? [];
      setNodeLines(initial.slice(-NODE_LOG_CAP));
    }).catch(() => {});

    void onNodeLog((line) => {
      setNodeLines((prev) => {
        const next = [...prev, line].slice(-NODE_LOG_CAP);
        return next;
      });
      checkPairing(line);
    }).then((fn) => { unlistenRef.current = fn; });

    return () => { unlistenRef.current?.(); };
  }, [checkPairing]);

  // ---- Gateway logs polling ----
  const fetchGwLogs = useCallback(async () => {
    if (!connected) { return; }

    const params: Record<string, unknown> = { limit: 120 };
    if (gwCursorRef.current !== undefined) {
      params.cursor = gwCursorRef.current;
    }

    const res = await rpc<LogsTailResult>("logs.tail", params);
    if (!res.ok || !res.payload) { return; }

    const payload = res.payload;
    if (typeof payload.cursor === "number") {
      gwCursorRef.current = payload.cursor;
    }

    const shouldReset = Boolean(payload.reset || gwCursorRef.current == null);

    // Parse entries from structured entries array or raw lines
    let parsed: GatewayLogEntry[] = [];
    if (Array.isArray(payload.entries) && payload.entries.length > 0) {
      parsed = payload.entries.map(parseStructuredEntry);
    } else if (Array.isArray(payload.lines)) {
      const lines = payload.lines.filter((l): l is string => typeof l === "string");
      parsed = lines.map(parseLogLine);
    }

    if (parsed.length === 0) { return; }

    setGwEntries((prev) => {
      const merged = shouldReset ? parsed : [...prev, ...parsed];
      if (merged.length > GW_LOG_CAP) {
        return merged.slice(merged.length - GW_LOG_CAP);
      }
      return merged;
    });

    if (!isNearBottom.current) {
      setUnseenCount((prev) => prev + parsed.length);
    }
  }, [connected, rpc]);

  useEffect(() => {
    if (tab !== "gateway" || !connected || !gwTailing) { return; }

    void fetchGwLogs();
    const timer = setInterval(() => void fetchGwLogs(), GW_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [tab, connected, gwTailing, fetchGwLogs]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && isNearBottom.current) {
      scrollToBottom();
    }
  }, [nodeLines, gwEntries, autoScroll, scrollToBottom]);

  // ---- Filter logic ----
  const filteredNodeLines = useMemo(() => {
    return nodeLines.filter((line) => {
      if (line.startsWith("[stdout]") && !nodeFilters.has("stdout")) { return false; }
      if (line.startsWith("[stderr]") && !nodeFilters.has("stderr")) { return false; }
      if (line.startsWith("[ui]") && !nodeFilters.has("ui")) { return false; }
      return true;
    });
  }, [nodeLines, nodeFilters]);

  const filteredGwEntries = useMemo(() => {
    const loweredSub = gwSubsystemFilter.trim().toLowerCase();
    const loweredSearch = gwSearchText.trim().toLowerCase();

    return gwEntries.filter((entry) => {
      if (entry.level && !gwLevelFilter.has(entry.level)) { return false; }
      if (loweredSub && !(entry.subsystem ?? "").toLowerCase().includes(loweredSub)) { return false; }
      if (loweredSearch && !entry.message.toLowerCase().includes(loweredSearch)) { return false; }
      return true;
    });
  }, [gwEntries, gwLevelFilter, gwSubsystemFilter, gwSearchText]);

  const toggleNodeFilter = (f: LogFilter) => {
    setNodeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) { next.delete(f); } else { next.add(f); }
      return next;
    });
  };

  const toggleGwLevel = (l: LogLevel) => {
    setGwLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(l)) { next.delete(l); } else { next.add(l); }
      return next;
    });
  };

  const handleClear = () => {
    if (tab === "node") {
      setNodeLines([]);
    } else {
      setGwEntries([]);
      gwCursorRef.current = undefined;
    }
  };

  return (
    <PageTransition>
      <div className="flex flex-col h-full space-y-4">
        <FadeIn>
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Logs</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Real-time log streams from the node and gateway.
            </p>
          </div>
        </FadeIn>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 border-b border-neutral-800">
          {(["node", "gateway"] as LogTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                tab === t
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-neutral-500 hover:text-neutral-300 hover:border-neutral-600",
              )}
            >
              {t === "node" ? "Node Logs" : "Gateway Logs"}
              {t === "gateway" && !connected && (
                <span className="text-[10px] text-neutral-500">(offline)</span>
              )}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <Card className="!p-2 sm:!p-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {tab === "gateway" && (
              <Button
                variant={gwTailing ? "primary" : "secondary"}
                onClick={() => setGwTailing((prev) => !prev)}
              >
                {gwTailing ? <Pause size={14} /> : <Play size={14} />}
                {gwTailing ? "Tailing" : "Paused"}
              </Button>
            )}

            <Button variant="ghost" onClick={handleClear}>
              <Trash2 size={14} />
              Clear
            </Button>

            <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-primary-500 cursor-pointer"
              />
              Auto-scroll
            </label>

            <span className="text-neutral-700">|</span>

            {tab === "node" && (
              <>
                {(["stdout", "stderr", "ui"] as LogFilter[]).map((f) => (
                  <label
                    key={f}
                    className={cn(
                      "flex items-center gap-1.5 text-xs cursor-pointer",
                      nodeFilters.has(f) ? "text-neutral-300" : "text-neutral-600",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={nodeFilters.has(f)}
                      onChange={() => toggleNodeFilter(f)}
                      className="accent-primary-500 cursor-pointer"
                    />
                    {f}
                  </label>
                ))}
                <div className="flex-1" />
                <Badge variant="default">
                  {filteredNodeLines.length} / {nodeLines.length}
                </Badge>
              </>
            )}

            {tab === "gateway" && (
              <>
                <div className="flex items-center gap-1">
                  <Filter size={12} className="text-neutral-500" />
                  {ALL_LEVELS.map((l) => (
                    <button
                      key={l}
                      onClick={() => toggleGwLevel(l)}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase transition-colors",
                        gwLevelFilter.has(l) ? LEVEL_BG[l] : "bg-neutral-900 text-neutral-600",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  placeholder="Subsystem..."
                  value={gwSubsystemFilter}
                  onChange={(e) => setGwSubsystemFilter(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900/60 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-primary-500 w-28"
                />

                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={gwSearchText}
                    onChange={(e) => setGwSearchText(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900/60 pl-7 pr-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-primary-500 w-36"
                  />
                </div>

                <div className="flex-1" />
                <Badge variant="default">
                  {filteredGwEntries.length} / {gwEntries.length}
                </Badge>
              </>
            )}
          </div>
        </Card>

        {/* Pairing callout (Node tab only) */}
        <AnimatePresence>
          {tab === "node" && showPairing && !pairingDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary-500/10 border border-primary-500/20 text-sm text-primary-300"
            >
              <span className="flex-1">A pairing request is pending. Check your mobile device to approve.</span>
              <button
                onClick={() => { setPairingDismissed(true); setShowPairing(false); }}
                className="text-neutral-400 hover:text-neutral-200 text-lg leading-none"
              >
                ×
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Log terminal */}
        <div className="relative flex-1 min-h-0">
          <Card className="!p-0 h-full flex flex-col">
            {tab === "node" && filteredNodeLines.length === 0 && (
              <EmptyState icon={ScrollText} title="No log output" description="Logs will appear when the node starts." />
            )}
            {tab === "gateway" && filteredGwEntries.length === 0 && (
              <EmptyState
                icon={ScrollText}
                title="No log entries"
                description={
                  gwTailing
                    ? connected
                      ? "Waiting for log data from the gateway..."
                      : "Connect to the gateway to view logs."
                    : "Auto-tail is paused. Press play to start streaming."
                }
              />
            )}

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-auto font-mono text-xs leading-5 p-3 scrollbar-thin scrollbar-track-neutral-900 scrollbar-thumb-neutral-700"
            >
              {tab === "node" && filteredNodeLines.map((line, i) => (
                <div key={i} style={{ color: nodeLineColor(line) }}>
                  {line.startsWith("[ui]") ? <em>{line}</em> : line}
                </div>
              ))}

              {tab === "gateway" && filteredGwEntries.map((entry, i) => (
                <GatewayLogRow key={`${entry.time ?? "t"}:${i}`} entry={entry} index={i} />
              ))}
            </div>
          </Card>

          {/* Jump to bottom FAB */}
          {!isNearBottom.current && (tab === "node" ? filteredNodeLines.length > 0 : filteredGwEntries.length > 0) && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium shadow-lg transition-colors"
            >
              <ArrowDown size={14} />
              {unseenCount > 0 ? `${unseenCount} new` : "Jump to bottom"}
            </button>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

// ---------------------------------------------------------------------------
// Gateway Log Row
// ---------------------------------------------------------------------------

function GatewayLogRow({ entry, index }: { entry: GatewayLogEntry; index: number }) {
  const timeStr = entry.time
    ? (entry.time.length > 11 ? entry.time.slice(11, 23) : entry.time)
    : "";

  return (
    <div className="flex items-start gap-2 py-px hover:bg-neutral-800/30 transition-colors">
      <span className="text-neutral-600 select-none w-8 text-right shrink-0">{index + 1}</span>
      {timeStr && (
        <span className="text-neutral-500 shrink-0">{timeStr}</span>
      )}
      {entry.level && (
        <span className={cn("uppercase font-semibold shrink-0 w-12", LEVEL_COLORS[entry.level])}>
          {entry.level}
        </span>
      )}
      {entry.subsystem && (
        <span className="text-neutral-500 shrink-0 max-w-[120px] truncate">[{entry.subsystem}]</span>
      )}
      <span className="text-neutral-200 break-all">{entry.message}</span>
    </div>
  );
}
