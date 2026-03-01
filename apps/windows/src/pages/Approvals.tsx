import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "../components/ui/Button";
import type { ApprovalPreview, ApprovalDecision } from "../tauri/types";
import { getPendingApprovals, decideApproval, gatewayRpc } from "../tauri/commands";
import { onApprovalPending, onApprovalResolved } from "../tauri/events";
import { useGatewayEvent } from "../hooks/useGatewayEvent";
import { useGateway } from "../gateway/context";

interface ApprovalsProps {
  onCountChange: (n: number) => void;
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalPreview;
  onDecide: (id: string, decision: ApprovalDecision) => Promise<void>;
}) {
  const rawCmd =
    approval.rawCommand ||
    (Array.isArray(approval.argv) ? approval.argv.join(" ") : "");
  const [expanded, setExpanded] = useState(false);
  const isTruncated = rawCmd.length > 400;
  const displayCmd = expanded || !isTruncated ? rawCmd : rawCmd.slice(0, 400);

  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((approval.expiresAtMs - Date.now()) / 1000))
  );
  const urgent = remaining < 10;

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Command */}
      <div
        style={{
          background: "var(--log-bg)",
          borderRadius: "var(--radius-sm)",
          padding: "8px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-primary)",
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {displayCmd}
        {isTruncated && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              display: "block",
              marginTop: "4px",
              background: "none",
              border: "none",
              color: "var(--accent-light)",
              cursor: "pointer",
              fontSize: "11px",
              padding: 0,
            }}
          >
            {expanded ? "[Show less]" : "[Show more]"}
          </button>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {approval.cwd && (
          <MetaChip label="cwd" value={approval.cwd} />
        )}
        {approval.envKeys.length > 0 && (
          <MetaChip label="env" value={approval.envKeys.join(", ")} />
        )}
        {approval.agentId && (
          <MetaChip label="agent" value={approval.agentId} />
        )}
        {approval.sessionKey && (
          <MetaChip label="session" value={approval.sessionKey} />
        )}
      </div>

      {/* Countdown + Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <motion.span
          animate={urgent ? { scale: [1, 1.05, 1] } : {}}
          transition={urgent ? { repeat: Infinity, duration: 1 } : {}}
          style={{
            fontSize: "12px",
            color: urgent ? "#ef4444" : "var(--text-muted)",
            fontWeight: urgent ? 600 : 400,
          }}
        >
          {remaining > 0 ? `${remaining}s remaining` : "Expired"}
        </motion.span>
        <div style={{ display: "flex", gap: "6px" }}>
          <Button variant="danger" size="sm" onClick={() => onDecide(approval.id, "deny")}>
            Deny
          </Button>
          <Button variant="warning" size="sm" onClick={() => onDecide(approval.id, "allow-once")}>
            Allow Once
          </Button>
          <Button variant="success" size="sm" onClick={() => onDecide(approval.id, "allow-always")}>
            Allow Always
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
      <span style={{ color: "var(--text-muted)", marginRight: "3px" }}>{label}:</span>
      {value}
    </span>
  );
}

/** Convert a raw gateway exec.approval.requested payload into ApprovalPreview */
function gatewayPayloadToPreview(payload: Record<string, unknown>): ApprovalPreview | null {
  try {
    const id = typeof payload.id === "string" ? payload.id : null;
    const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : Date.now() + 30000;
    const req = (payload.request ?? {}) as Record<string, unknown>;
    const argv = Array.isArray(req.commandArgv) ? (req.commandArgv as string[]) : [];
    const rawCommand = typeof req.command === "string" ? req.command : argv.join(" ");
    const envKeys = Array.isArray(req.envKeys) ? (req.envKeys as string[]) : [];
    const plan = (req.systemRunPlanV2 ?? req.systemRunBindingV1 ?? {}) as Record<string, unknown>;
    const cwd = typeof plan.cwd === "string" ? plan.cwd : (typeof req.cwd === "string" ? req.cwd : null);
    const agentId = typeof plan.agentId === "string" ? plan.agentId : null;
    const sessionKey = typeof plan.sessionKey === "string" ? plan.sessionKey : null;
    if (!id) { return null; }
    return { id, rawCommand, argv, cwd, envKeys, agentId, sessionKey, expiresAtMs };
  } catch {
    return null;
  }
}

export function Approvals({ onCountChange }: ApprovalsProps) {
  const [approvals, setApprovals] = useState<ApprovalPreview[]>([]);
  const unlistensRef = useRef<Array<() => void>>([]);
  const { status: gwStatus } = useGateway();
  const gatewayConnected = gwStatus.state === "connected";

  // Gateway approval events
  useGatewayEvent("exec.approval.requested", (payload) => {
    const preview = gatewayPayloadToPreview(payload as Record<string, unknown>);
    if (!preview) { return; }
    setApprovals((prev) => {
      if (prev.find((x) => x.id === preview.id)) { return prev; }
      return [...prev, preview];
    });
  });

  useGatewayEvent("exec.approval.resolved", (payload) => {
    const p = payload as { id?: string };
    if (p?.id) {
      setApprovals((prev) => prev.filter((a) => a.id !== p.id));
    }
  });

  useEffect(() => {
    void getPendingApprovals().then((pending) => {
      setApprovals(pending ?? []);
    }).catch(() => {});

    void onApprovalPending((a) => {
      setApprovals((prev) => {
        if (prev.find((x) => x.id === a.id)) { return prev; }
        return [...prev, a];
      });
    }).then((fn) => unlistensRef.current.push(fn));

    void onApprovalResolved((id) => {
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    }).then((fn) => unlistensRef.current.push(fn));

    return () => {
      unlistensRef.current.forEach((fn) => fn());
      unlistensRef.current = [];
    };
  }, []);

  useEffect(() => {
    onCountChange(approvals.length);
  }, [approvals.length, onCountChange]);

  async function handleDecide(id: string, decision: ApprovalDecision) {
    // Try local exec-host first, fall back to gateway RPC
    try {
      await decideApproval(id, decision);
    } catch {
      // If local fails, try resolving via gateway
      if (gatewayConnected) {
        try {
          await gatewayRpc("exec.approval.resolve", { id, decision });
        } catch { /* card removed by event */ }
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "680px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {approvals.length === 0
            ? "No pending approvals"
            : `${approvals.length} pending approval${approvals.length !== 1 ? "s" : ""}`}
        </span>
        {gatewayConnected && (
          <span style={{ fontSize: "11px", color: "var(--accent-light)", marginLeft: "auto" }}>
            Gateway connected — receiving remote approvals
          </span>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {approvals.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              textAlign: "center",
              padding: "48px 0",
              color: "var(--text-muted)",
              fontSize: "13px",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔐</div>
            <div>No pending approvals</div>
            <div style={{ marginTop: "4px", fontSize: "12px" }}>
              Commands requiring exec-host approval will appear here.
            </div>
          </motion.div>
        ) : (
          approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDecide={handleDecide} />
          ))
        )}
      </AnimatePresence>
    </div>
  );
}
