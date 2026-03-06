import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { PageId } from "../../types";
import type { NodeStatusString } from "../../tauri/types";
import type { GatewayStatus } from "../../gateway/types";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomBar } from "./BottomBar";

interface ShellProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  status: NodeStatusString;
  approvalCount: number;
  gwStatus: GatewayStatus;
  gatewayActionError?: string | null;
  onRetryConnect?: () => void;
  children: ReactNode;
}

export function Shell({
  activePage,
  onNavigate,
  status,
  approvalCount,
  gwStatus,
  gatewayActionError,
  onRetryConnect,
  children,
}: ShellProps) {
  return (
    <div className="shell">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        approvalCount={approvalCount}
      />

      <div className="right-pane">
        <TopBar
          activePage={activePage}
          status={status}
          gwStatus={gwStatus}
          gatewayActionError={gatewayActionError}
          onRetryConnect={onRetryConnect}
        />

        <div className="content-wrap">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              className="content-scroll"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>

        <BottomBar />
      </div>
    </div>
  );
}
