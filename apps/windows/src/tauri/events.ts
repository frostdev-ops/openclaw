import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NodeStatusString, ApprovalPreview } from "./types";

export function onNodeStatusChanged(
  cb: (status: NodeStatusString) => void
): Promise<UnlistenFn> {
  return listen<string>("node-status-changed", (event) => {
    cb(event.payload as NodeStatusString);
  });
}

export function onNodeLog(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("node-log", (event) => {
    cb(event.payload);
  });
}

export function onApprovalPending(
  cb: (approval: ApprovalPreview) => void
): Promise<UnlistenFn> {
  return listen<ApprovalPreview>("approval-pending", (event) => {
    cb(event.payload);
  });
}

export function onInstallPathDetected(
  cb: (path: string) => void
): Promise<UnlistenFn> {
  return listen<string>("install-path-detected", (event) => {
    cb(event.payload);
  });
}

export function onApprovalResolved(
  cb: (id: string) => void
): Promise<UnlistenFn> {
  return listen<{ id: string } | string>("approval-resolved", (event) => {
    const payload = event.payload;
    cb(typeof payload === "string" ? payload : payload.id);
  });
}
