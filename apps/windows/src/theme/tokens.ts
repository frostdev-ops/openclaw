import type { NodeStatusString } from "../tauri/types";

export const STATUS_COLORS: Record<NodeStatusString, string> = {
  stopped: "#ef4444",
  starting: "#eab308",
  running: "#22c55e",
  reconnecting: "#f97316",
  disconnected: "#f97316",
  error: "#ef4444",
};

export const STATUS_LABELS: Record<NodeStatusString, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  error: "Error",
};
