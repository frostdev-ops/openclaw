import { invoke } from "@tauri-apps/api/core";
import type {
  NodeClientConfig,
  NodeClientStatus,
  ApprovalPreview,
  ApprovalDecision,
  DiscoveryResult,
  ExecPolicyConfig,
  AllowlistEntry,
} from "./types";
import type { GatewayConnectionStatus, GatewayRpcResult } from "../gateway/types";

export async function getConfig(): Promise<NodeClientConfig> {
  return invoke<NodeClientConfig>("get_config");
}

export async function setConfig(config: NodeClientConfig): Promise<void> {
  return invoke("set_config", { config });
}

export async function getStatus(): Promise<NodeClientStatus> {
  return invoke<NodeClientStatus>("get_status");
}

export async function startNode(): Promise<void> {
  return invoke("start_node");
}

export async function stopNode(): Promise<void> {
  return invoke("stop_node");
}

export async function restartNode(): Promise<void> {
  return invoke("restart_node");
}

export async function getPendingApprovals(): Promise<ApprovalPreview[]> {
  return invoke<ApprovalPreview[]>("get_pending_approvals");
}

export async function decideApproval(
  id: string,
  decision: ApprovalDecision
): Promise<void> {
  return invoke("decide_approval", { id, decision });
}

export async function enableAutostart(): Promise<void> {
  return invoke("enable_autostart");
}

export async function disableAutostart(): Promise<void> {
  return invoke("disable_autostart");
}

export async function isAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>("is_autostart_enabled");
}

export async function getInstallPath(): Promise<string | null> {
  return invoke<string | null>("get_install_path");
}

export async function setInstallPath(path: string | null): Promise<void> {
  return invoke("set_install_path", { path });
}

export async function importOpenclawConfig(): Promise<NodeClientConfig | null> {
  return invoke<NodeClientConfig | null>("import_openclaw_config");
}

export async function detectInstallPath(): Promise<DiscoveryResult | null> {
  return invoke<DiscoveryResult | null>("detect_install_path");
}

export async function getExecPolicy(): Promise<ExecPolicyConfig> {
  return invoke<ExecPolicyConfig>("get_exec_policy");
}

export async function setExecPolicy(
  security: string | null,
  ask: string | null,
  askFallback: string | null,
): Promise<void> {
  return invoke("set_exec_policy", { security, ask, askFallback });
}

export async function getExecAllowlist(): Promise<AllowlistEntry[]> {
  return invoke<AllowlistEntry[]>("get_exec_allowlist");
}

export async function addAllowlistEntry(pattern: string): Promise<void> {
  return invoke("add_allowlist_entry", { pattern });
}

export async function removeAllowlistEntry(pattern: string): Promise<void> {
  return invoke("remove_allowlist_entry", { pattern });
}

// ---------------------------------------------------------------------------
// Gateway WebSocket commands
// ---------------------------------------------------------------------------

export interface GatewayConnectParams {
  host: string;
  port: number;
  tls: boolean;
  token?: string | null;
  password?: string | null;
  nodeId?: string | null;
  displayName?: string | null;
}

export async function gatewayConnect(
  params: GatewayConnectParams
): Promise<{ ok: boolean; error?: string }> {
  return invoke("gateway_connect", {
    host: params.host,
    port: params.port,
    tls: params.tls,
    token: params.token ?? null,
    password: params.password ?? null,
    nodeId: params.nodeId ?? null,
    displayName: params.displayName ?? null,
  });
}

export async function gatewayDisconnect(): Promise<void> {
  return invoke("gateway_disconnect");
}

export async function gatewayStatus(): Promise<GatewayConnectionStatus> {
  return invoke<GatewayConnectionStatus>("gateway_status");
}

export async function gatewayRpc<T = unknown>(
  method: string,
  params?: Record<string, unknown> | null
): Promise<GatewayRpcResult<T>> {
  return invoke<GatewayRpcResult<T>>("gateway_rpc", { method, params: params ?? null });
}
