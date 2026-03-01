export type PageId =
  | "overview" | "channels" | "instances" | "sessions" | "usage" | "cron"
  | "agents" | "skills" | "nodes"
  | "config" | "approvals" | "logs" | "security" | "chat";

export type PageState = {
  sessionKey?: string;
  agentId?: string;
};
