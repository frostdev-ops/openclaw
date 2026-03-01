export type ToolCallData = { name: string; input: unknown };
export type ToolResultData = { name: string; output: unknown };

export type ChatImage = {
  mimeType: string;
  data: string; // base64 (no data: prefix)
  fileName?: string;
  previewUrl?: string; // object URL for local preview
};

export interface MessageOrigin {
  provider?: string;
  surface?: string;
  chatType?: string;
  from?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  label?: string;
  routedModel?: string;
  avatarUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  specialFormat?: "system-note" | "heartbeat-request" | "heartbeat-ok";
  senderColor?: string;
  metadataPrefixes?: string[];
  runId?: string;
  streaming?: boolean;
  toolCall?: ToolCallData;
  toolResult?: ToolResultData;
  origin?: MessageOrigin;
  images?: ChatImage[];
}

export type ChatEventPayload = {
  runId?: unknown;
  sessionKey?: unknown;
  state?: unknown;
  message?: unknown;
  errorMessage?: unknown;
};

export type AgentToolEventPayload = {
  runId?: unknown;
  stream?: unknown;
  ts?: unknown;
  sessionKey?: unknown;
  data?: unknown;
};

export type ExtractedToolItem =
  | { kind: "call"; name: string; payload: unknown }
  | { kind: "result"; name: string; payload: unknown };
