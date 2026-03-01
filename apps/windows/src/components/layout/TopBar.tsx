import { useCallback } from "react";
import type { NodeStatusString } from "../../tauri/types";
import type { GatewayStatus } from "../../gateway/types";
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
  gwStatus: GatewayStatus;
  onRetryConnect?: () => void;
}

export function TopBar({ activePage, status, gwStatus, onRetryConnect }: TopBarProps) {
  const isRunning = status === "running";
  const isPairing = gwStatus.state === "pairing";
  const isConnected = gwStatus.state === "connected";

  const handleRetry = useCallback(() => {
    onRetryConnect?.();
  }, [onRetryConnect]);

  return (
    <>
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
          <div className={`pill ${isConnected ? "ok" : isPairing ? "warn" : "muted"}`}>
            <Icon name="link" size={11} />
            {isConnected ? "Connected" : isPairing ? "Pairing" : "Disconnected"}
          </div>
        </div>
      </div>

      {isPairing && (
        <div className="pairing-banner">
          <Icon name="alertTriangle" size={14} />
          <span>
            <strong>Pairing required</strong> — run{" "}
            <code>openclaw devices approve {gwStatus.pairingRequestId ?? "..."}</code>{" "}
            on your gateway
          </span>
          {gwStatus.deviceId && (
            <span className="pairing-banner-device">
              Device: {gwStatus.deviceId.slice(0, 16)}...
            </span>
          )}
          {onRetryConnect && (
            <button className="pairing-banner-retry" onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}
