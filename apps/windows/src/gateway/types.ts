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

export interface ChannelAccountSnapshot {
  accountId?: string;
  connected?: boolean;
  running?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number;
  lastError?: string;
  dmPolicy?: string;
  mode?: string;
  linked?: boolean;
  error?: string;
}

export interface ChannelStatus {
  channelId: string;
  configured?: boolean;
  accounts?: ChannelAccountSnapshot[];
  error?: string;
}

export interface ChannelsStatusSnapshot {
  channels: ChannelStatus[];
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelAccounts?: Record<string, ChannelAccountSnapshot[]>;
  channelMeta?: Record<string, unknown>;
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
  displayName?: string;
  derivedTitle?: string;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  totalTokens?: number;
  updatedAt?: string;
  lastChannel?: string;
  modelProvider?: string;
}

export interface StatusSummary {
  sessions: number;
  activeSessions: number;
  channels: number;
  connectedChannels: number;
  agents: number;
  skills: number;
  cronJobs: number;
  uptime?: number;
  version?: string;
}

export interface CronScheduleInterval {
  kind: string;
  everyMs?: number;
  anchorMs?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule?: string | CronScheduleInterval;
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

export interface CronStatus {
  jobs: number;
  enabled: boolean;
  nextWakeAtMs?: number;
}

export interface CronRunLogEntry {
  ts: number;
  jobId: string;
  jobName?: string;
  status: string;
  durationMs?: number;
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
  missingDeps?: Array<string | { dep: string; installOptions?: string[] }>;
  emoji?: string;
  description?: string;
  bundled?: boolean;
  requirements?: {
    bins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
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

export interface SessionsUsageResult {
  sessions: GatewaySessionRow[];
  aggregates: SessionsUsageAggregates;
  cost?: CostUsageSummary;
}

export interface CostUsageSummary {
  totalCostUsd: number;
  byModel: Record<string, number>;
  byChannel: Record<string, number>;
}

export interface SessionsUsageAggregates {
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface AgentFile {
  path: string;
  content?: string;
}

export interface AgentFilesListResult {
  files: AgentFile[];
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  toolCalls?: Array<{ name: string; args?: unknown; result?: unknown }>;
  images?: string[];
}

export interface ChatHistoryResult {
  messages: ChatMessage[];
  sessionKey: string;
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
  auth?: {
    role: string;
    scopes: string[];
    deviceToken?: string;
    issuedAtMs?: number;
  };
}

// Status of the gateway connection
export type GatewayConnectionState = "disconnected" | "connecting" | "connected" | "error" | "pairing";

export type GatewayConnectionStatus = GatewayStatus;

export interface GatewayStatus {
  state: GatewayConnectionState;
  connId?: string;
  protocol?: number;
  serverVersion?: string;
  error?: string;
  connectedAtMs?: number;
  pairingRequestId?: string;
  deviceId?: string;
}

// RPC result from gateway_rpc Tauri command
export interface GatewayRpcResult<T = unknown> {
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}
