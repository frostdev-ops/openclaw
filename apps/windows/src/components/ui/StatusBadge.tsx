import { motion } from "motion/react";
import type { NodeStatusString } from "../../tauri/types";

const STATUS_COLORS: Record<NodeStatusString, string> = {
  stopped: "#ef4444",
  starting: "#eab308",
  running: "#22c55e",
  reconnecting: "#f97316",
  disconnected: "#f97316",
  error: "#ef4444",
};

const STATUS_LABELS: Record<NodeStatusString, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  error: "Error",
};

interface StatusBadgeProps {
  status: NodeStatusString;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const color = STATUS_COLORS[status];
  return (
    <motion.div
      animate={{ backgroundColor: color + "26", borderColor: color }}
      transition={{ duration: 0.4 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size === "sm" ? "5px" : "7px",
        padding: size === "sm" ? "2px 8px" : "4px 12px",
        borderRadius: "999px",
        border: "1px solid",
        fontSize: size === "sm" ? "11px" : "13px",
        fontWeight: 500,
      }}
    >
      <motion.span
        animate={{ backgroundColor: color }}
        transition={{ duration: 0.4 }}
        style={{
          width: size === "sm" ? 6 : 8,
          height: size === "sm" ? 6 : 8,
          borderRadius: "50%",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--text-primary)" }}>{STATUS_LABELS[status]}</span>
    </motion.div>
  );
}
