import { useState, useEffect, useCallback } from "react";
import { Shell } from "./components/layout/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
import { Chat } from "./pages/Chat";
import { SessionReplay } from "./pages/SessionReplay";
import { GatewayProvider, useGateway } from "./gateway/context";
import { subscribeGatewayEvents } from "./stores/connection";
import type { PageId, PageState } from "./types";
import type { NodeStatusString } from "./tauri/types";
import { getConfig, getStatus, gatewayConnect } from "./tauri/commands";
import { onNodeStatusChanged } from "./tauri/events";

// Initialize gateway event subscriptions for Zustand stores
subscribeGatewayEvents();

function AppContent() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [pageState, setPageState] = useState<PageState>({});
  const [status, setStatus] = useState<NodeStatusString>("stopped");
  const [approvalCount, setApprovalCount] = useState(0);
  const { status: gwStatus } = useGateway();

  const onNavigate = useCallback((page: PageId, state?: PageState) => {
    setActivePage(page);
    setPageState(state ?? {});
  }, []);

  const handleRetryConnect = useCallback(async () => {
    try {
      const cfg = await getConfig();
      await gatewayConnect({
        host: cfg.host,
        port: cfg.port,
        tls: cfg.tls,
        token: cfg.gatewayToken,
        password: cfg.gatewayPassword,
        nodeId: cfg.nodeId,
        displayName: cfg.displayName,
      });
    } catch {
      // retry failed silently — status poll will update UI
    }
  }, []);

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
            onNavigateToLogs={() => onNavigate("logs")}
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
      case "chat":
        return <Chat onNavigate={onNavigate} />;
      case "sessions":
        if (pageState.sessionKey) {
          return (
            <SessionReplay
              sessionKey={pageState.sessionKey}
              onBack={() => onNavigate("sessions", {})}
            />
          );
        }
        return <Sessions onNavigate={onNavigate} pageState={pageState} />;
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
      default:
        return null;
    }
  };

  return (
    <Shell
      activePage={activePage}
      onNavigate={onNavigate}
      status={status}
      approvalCount={approvalCount}
      gwStatus={gwStatus}
      onRetryConnect={handleRetryConnect}
    >
      <ErrorBoundary key={activePage}>
        {renderPage()}
      </ErrorBoundary>
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
