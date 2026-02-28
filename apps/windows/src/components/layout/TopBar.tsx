import type { NodeStatusString } from "../../tauri/types";
import { Icon } from "../ui/Icon";

const PAGE_LABELS: Record<string, string> = {
  overview: "Overview",
  channels: "Channels",
  instances: "Instances",
  sessions: "Sessions",
  usage: "Usage",
  cron: "Cron Jobs",
  agents: "Agents",
  skills: "Skills",
  nodes: "Nodes",
  config: "Configuration",
  approvals: "Approvals",
  logs: "Logs",
  security: "Security",
};

interface TopBarProps {
  activePage: string;
  status: NodeStatusString;
  gatewayConnected: boolean;
}

export function TopBar({ activePage, status, gatewayConnected }: TopBarProps) {
  const isRunning = status === "running";
  return (
    <div className="topbar">
      <div>
        <div className="topbar-brand-name">OPENCLAW</div>
        <div className="topbar-brand-sub">CONTROL SURFACE</div>
      </div>

      <div className="topbar-breadcrumb">
        Control Surface /&nbsp;
        <span className="topbar-breadcrumb-current">
          {PAGE_LABELS[activePage] ?? activePage}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div className={`pill ${isRunning ? "ok" : status === "error" ? "danger" : "muted"}`}>
          <span className={`statusDot ${isRunning ? "ok" : status === "error" ? "danger" : "muted"}`} />
          {isRunning ? "Node running" : status}
        </div>
        <div className={`pill ${gatewayConnected ? "ok" : "muted"}`}>
          <Icon name="link" size={11} />
          {gatewayConnected ? "Connected" : "Disconnected"}
        </div>
      </div>
    </div>
  );
}
