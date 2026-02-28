import { useState, useEffect, useCallback } from "react";
import { Shell } from "./components/layout/Shell";
import { Overview } from "./pages/Overview";
import { Channels } from "./pages/Channels";
import { Sessions } from "./pages/Sessions";
import { Usage } from "./pages/Usage";
import { Agents } from "./pages/Agents";
import { Skills } from "./pages/Skills";
import { Instances } from "./pages/Instances";
import { Cron } from "./pages/Cron";
import { Nodes } from "./pages/Nodes";
import { Approvals } from "./pages/Approvals";
import { Logs } from "./pages/Logs";
import { Config } from "./pages/Config";
import { Security } from "./pages/Security";
import { GatewayProvider, useGateway } from "./gateway/context";
import type { PageId } from "./types";
import type { NodeStatusString } from "./tauri/types";
import { getStatus } from "./tauri/commands";
import { onNodeStatusChanged } from "./tauri/events";

function AppContent() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [status, setStatus] = useState<NodeStatusString>("stopped");
  const [approvalCount, setApprovalCount] = useState(0);
  const { status: gwStatus } = useGateway();

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s.status ?? (s.running ? "running" : "stopped"));
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), 7000);
    let unlisten: (() => void) | null = null;
    void onNodeStatusChanged((s) => setStatus(s)).then((fn) => { unlisten = fn; });
    return () => {
      clearInterval(interval);
      unlisten?.();
    };
  }, [refreshStatus]);

  const renderPage = () => {
    switch (activePage) {
      case "overview":
        return (
          <Overview
            status={status}
            onStatusChange={setStatus}
            onNavigateToLogs={() => setActivePage("logs")}
          />
        );
      case "approvals":
        return <Approvals onCountChange={setApprovalCount} />;
      case "logs":
        return <Logs />;
      case "config":
        return <Config />;
      case "security":
        return <Security />;
      case "channels":
        return <Channels />;
      case "sessions":
        return <Sessions />;
      case "usage":
        return <Usage />;
      case "agents":
        return <Agents />;
      case "skills":
        return <Skills />;
      case "instances":
        return <Instances />;
      case "cron":
        return <Cron />;
      case "nodes":
        return <Nodes />;
    }
  };

  return (
    <Shell
      activePage={activePage}
      onNavigate={setActivePage}
      status={status}
      approvalCount={approvalCount}
      gatewayConnected={gwStatus.state === "connected"}
    >
      {renderPage()}
    </Shell>
  );
}

export function App() {
  return (
    <GatewayProvider>
      <AppContent />
    </GatewayProvider>
  );
}
