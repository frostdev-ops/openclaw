// Gateway data types matching the OpenClaw gateway protocol

export interface PresenceEntry {
  key: string;
  connId?: string;
  clientId?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  mode?: string;
  deviceFamily?: string;
  roles?: string[];
  scopes?: string[];
  connectedAtMs?: number;
  lastInputAtMs?: number;
}

export interface HealthSignal {
  key: string;
  status: "pass" | "fail" | "warn" | "unknown";
  value?: unknown;
  message?: string;
  updatedAtMs?: number;
}

export interface HealthSnapshot {
  passing: number;
  failing: number;
  warning: number;
  signals: HealthSignal[];
  metrics?: Record<string, number>;
  updatedAtMs?: number;
}

export interface ChannelAccountStatus {
  accountId?: string;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  error?: string;
}

export interface ChannelStatus {
  channelId: string;
  configured?: boolean;
  accounts?: ChannelAccountStatus[];
  error?: string;
}

export interface ChannelsStatusSnapshot {
  channels: ChannelStatus[];
}

export interface GatewaySessionRow {
  key: string;
  kind?: string;
  label?: string;
  surface?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  updatedAtMs?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule?: string;
  enabled?: boolean;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: string;
  command?: string;
}

export interface CronRun {
  id: string;
  jobId: string;
  startedAtMs: number;
  finishedAtMs?: number;
  status?: string;
  error?: string;
}

export interface GatewayAgentRow {
  agentId: string;
  name?: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
}

export interface SkillStatusEntry {
  skillId: string;
  name?: string;
  source?: string;
  eligible?: boolean;
  enabled?: boolean;
  blocked?: boolean;
  missingDeps?: string[];
}

export interface NodeEntry {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  connectedAtMs?: number;
  commands?: string[];
}

export interface LogEntry {
  level?: string;
  subsystem?: string;
  message: string;
  ts?: number;
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

// Hello-ok payload from the gateway connection handshake
export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: {
    presence: PresenceEntry[];
    health?: HealthSnapshot;
    stateVersion: Record<string, number>;
  };
  policy?: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

// Status of the gateway connection
export type GatewayConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type GatewayConnectionStatus = GatewayStatus;

export interface GatewayStatus {
  state: GatewayConnectionState;
  connId?: string;
  protocol?: number;
  serverVersion?: string;
  error?: string;
  connectedAtMs?: number;
}

// RPC result from gateway_rpc Tauri command
export interface GatewayRpcResult<T = unknown> {
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}
