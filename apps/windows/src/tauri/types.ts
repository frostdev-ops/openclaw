export type NodeStatusString =
  | "stopped"
  | "starting"
  | "running"
  | "reconnecting"
  | "disconnected"
  | "error";

export type ApprovalDecision = "deny" | "allow-once" | "allow-always";

export interface NodeClientConfig {
  host: string;
  port: number;
  tls: boolean;
  tlsFingerprint: string | null;
  nodeId: string | null;
  displayName: string | null;
  autoStartNode: boolean;
  useExecHost: boolean;
  execHostFallback: boolean;
  gatewayToken: string | null;
  gatewayPassword: string | null;
  installPath: string | null;
  useBundledRuntime: boolean;
}

export interface NodeClientStatus {
  running: boolean;
  status: NodeStatusString;
  gatewayUrl: string;
  lastError: string | null;
  logs: string[];
}

export interface DiscoveryResult {
  binDir: string;
  binPath: string;
  binName: string;
  method: string;
}

export interface ApprovalPreview {
  id: string;
  rawCommand: string;
  argv: string[];
  cwd: string | null;
  envKeys: string[];
  agentId: string | null;
  sessionKey: string | null;
  expiresAtMs: number;
}

export interface ExecPolicyConfig {
  security: string | null;
  ask: string | null;
  askFallback: string | null;
}

export interface AllowlistEntry {
  pattern: string;
  lastUsedAt: number | null;
}
