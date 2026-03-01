import type { ChatMessage, ChatImage, ExtractedToolItem, MessageOrigin } from "./types";

let nextId = 0;
export function makeId(): string {
  return `msg-${Date.now()}-${nextId++}`;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function normalizeRole(role: unknown): string {
  if (typeof role !== "string") {
    return "assistant";
  }
  const lowered = role.toLowerCase();
  if (
    lowered === "toolresult" ||
    lowered === "tool_result" ||
    lowered === "toolcall" ||
    lowered === "tool_call"
  ) {
    return "tool";
  }
  return lowered;
}

export function extractText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return null;
        }
        const item = part as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((part): part is string => typeof part === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  return null;
}

export function extractToolItems(message: unknown): ExtractedToolItem[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const items = content.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"),
  );
  const cards: ExtractedToolItem[] = [];
  for (const item of items) {
    const kind = typeof item.type === "string" ? item.type.toLowerCase() : "";
    const looksLikeCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (looksLikeCall) {
      cards.push({
        kind: "call",
        name: typeof item.name === "string" ? item.name : "tool",
        payload: item.arguments ?? item.args ?? {},
      });
    }
  }
  for (const item of items) {
    const kind = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if (kind !== "toolresult" && kind !== "tool_result") {
      continue;
    }
    let payload: unknown = item.text;
    if (payload == null && typeof item.content === "string") {
      payload = item.content;
    }
    if (payload == null) {
      payload = item.result ?? item;
    }
    cards.push({
      kind: "result",
      name: typeof item.name === "string" ? item.name : "tool",
      payload,
    });
  }
  return cards;
}

export function extractOrigin(m: Record<string, unknown>): MessageOrigin | undefined {
  const candidates = [
    m.origin,
    (m.meta as Record<string, unknown> | undefined)?.origin,
    (m.metadata as Record<string, unknown> | undefined)?.origin,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const o = candidate as Record<string, unknown>;
      const hasContent =
        typeof o.provider === "string" ||
        typeof o.from === "string" ||
        typeof o.surface === "string" ||
        typeof o.label === "string";
      if (hasContent) {
        const accountId = typeof o.accountId === "string" ? o.accountId : undefined;
        const provider = typeof o.provider === "string" ? o.provider : undefined;
        let avatarUrl: string | undefined;
        if (typeof o.avatarUrl === "string") {
          avatarUrl = o.avatarUrl;
        } else if (typeof o.avatar_url === "string") {
          avatarUrl = o.avatar_url;
        } else if (typeof o.profileImageUrl === "string") {
          avatarUrl = o.profileImageUrl;
        } else if (
          typeof o.avatar === "string" &&
          o.avatar.length < 50 &&
          accountId &&
          provider === "discord"
        ) {
          const hash = o.avatar;
          const ext = hash.startsWith("a_") ? "gif" : "webp";
          avatarUrl = `https://cdn.discordapp.com/avatars/${accountId}/${hash}.${ext}?size=128`;
        }
        return {
          provider,
          surface: typeof o.surface === "string" ? o.surface : undefined,
          chatType: typeof o.chatType === "string" ? o.chatType : undefined,
          from: typeof o.from === "string" ? o.from : undefined,
          to: typeof o.to === "string" ? o.to : undefined,
          accountId,
          threadId:
            typeof o.threadId === "string" || typeof o.threadId === "number"
              ? o.threadId
              : undefined,
          label: typeof o.label === "string" ? o.label : undefined,
          avatarUrl,
        };
      }
    }
  }
  return undefined;
}

// Content-based origin parsing
const BRACKET_PROVIDERS = new Set([
  "discord", "telegram", "slack", "whatsapp", "signal",
  "imessage", "nostr", "googlechat", "msteams", "email",
  "matrix", "irc", "webchat",
]);
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*([^\]\n]+))\s*\]\]/gi;
export const REPLY_TO_CURRENT_TARGET = "reply:current";
const METADATA_PREFIX_RE = /^\s*(\[[^[\]]+\])\s*/;
const PROVIDER_BRACKET_RE = /^\[([\w]+)\s+(\S+?)(?:\s+user\s+id:(\S+))?(?:\s+[^\]]*?)?\]$/i;
const DISCORD_HEADER_RE = /\[Discord\s+([^\]\s]+)\s+user id:([^\]\s]+)\s+([^\]]*?)\]/gi;
const DISCORD_HEADER_DETECT_RE = /\[Discord\s+/i;
const MESSAGE_ID_TRAILER_RE = /\n?\s*\[message_id:\s*([^\]\n]+)\]\s*$/i;
const SYSTEM_PREFIX_RE = /^System:\s*\[[^\]]+\]\s*/i;

type ParsedUserSegment = {
  role: string;
  content: string;
  origin?: MessageOrigin;
  metadataPrefixes?: string[];
  specialFormat?: ChatMessage["specialFormat"];
};

type ParsedContentResult = {
  content: string;
  origin?: MessageOrigin;
  metadataPrefixes?: string[];
  specialFormat?: ChatMessage["specialFormat"];
  segments?: ParsedUserSegment[];
};

export type AssistantDirectiveInfo = {
  content: string;
  replyToCurrent: boolean;
  explicitTarget?: string;
};

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSendTarget(rawTarget: unknown): string | undefined {
  const target = trimToUndefined(rawTarget);
  if (!target) {
    return undefined;
  }
  if (/^\d+$/.test(target)) {
    return `channel:${target}`;
  }
  return target;
}

export function stripAssistantDirectives(raw: string): AssistantDirectiveInfo {
  let replyToCurrent = false;
  let explicitTarget: string | undefined;
  const content = raw
    .replace(REPLY_TAG_RE, (_full, replyTo: string | undefined) => {
      const target = trimToUndefined(replyTo);
      if (target) {
        explicitTarget = target;
      } else {
        replyToCurrent = true;
      }
      return "";
    })
    .trim();
  return { content, replyToCurrent, explicitTarget };
}

function mergeMessageOrigins(
  primary?: MessageOrigin,
  fallback?: MessageOrigin,
): MessageOrigin | undefined {
  if (!primary && !fallback) {
    return undefined;
  }
  const merged: MessageOrigin = { ...fallback, ...primary };
  const hasValue = Object.values(merged).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  return hasValue ? merged : undefined;
}

function extractMessageToolSend(
  payload: unknown,
  mode: "call" | "result",
): { content?: string; origin?: MessageOrigin } | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const data = payload as Record<string, unknown>;
  const channel = trimToUndefined(data.channel);
  const normalizedTarget = normalizeSendTarget(data.target ?? data.to);
  const message = trimToUndefined(data.message);
  if (mode === "call") {
    const action = trimToUndefined(data.action)?.toLowerCase();
    if (action && action !== "send") {
      return undefined;
    }
    if (!message && !channel && !normalizedTarget) {
      return undefined;
    }
    const directives = stripAssistantDirectives(message ?? "");
    return {
      content: directives.content || undefined,
      origin: mergeMessageOrigins(
        {
          provider: channel,
          to:
            directives.explicitTarget ??
            normalizedTarget ??
            (directives.replyToCurrent ? REPLY_TO_CURRENT_TARGET : undefined),
        },
        undefined,
      ),
    };
  }
  const to = normalizeSendTarget(data.to);
  if (!channel && !to) {
    return undefined;
  }
  return { origin: { provider: channel, to } };
}

export function parseMessageToolCallPayload(
  payload: unknown,
): { content?: string; origin?: MessageOrigin } | undefined {
  return extractMessageToolSend(payload, "call");
}

export function parseMessageToolResultPayload(
  payload: unknown,
): { content?: string; origin?: MessageOrigin } | undefined {
  return extractMessageToolSend(payload, "result");
}

function parseContentOrigin(content: string, role: string): ParsedContentResult {
  if (role === "assistant") {
    return parseAssistantContent(content);
  }
  if (role === "user") {
    return parseUserContent(content);
  }
  return { content };
}

function normalizeSystemBlock(
  raw: string,
): { content: string; specialFormat?: ChatMessage["specialFormat"] } {
  const withoutPrefix = raw.replace(SYSTEM_PREFIX_RE, "").trim();
  const lines = withoutPrefix
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { content: "System update", specialFormat: "system-note" };
  }
  if (lines.length === 1 && lines[0]?.toUpperCase() === "HEARTBEAT_OK") {
    return { content: "Heartbeat acknowledged.", specialFormat: "heartbeat-ok" };
  }
  const hasHeartbeatRequest = /read\s+heartbeat\.md|reply\s+heartbeat_ok|heartbeat/i.test(
    withoutPrefix,
  );
  const cleaned = lines.filter((line) => line.toUpperCase() !== "HEARTBEAT_OK");
  const primaryLine = cleaned[0] ?? lines[0];
  if (hasHeartbeatRequest) {
    return {
      content: primaryLine || "Heartbeat check requested.",
      specialFormat: "heartbeat-request",
    };
  }
  return { content: primaryLine || "System update", specialFormat: "system-note" };
}

function parseDiscordSegments(raw: string): ParsedUserSegment[] {
  const matches = Array.from(raw.matchAll(DISCORD_HEADER_RE));
  if (matches.length === 0) {
    return [];
  }
  const segments: ParsedUserSegment[] = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current || current.index == null) {
      continue;
    }
    const next = matches[i + 1];
    const blockStart = current.index + current[0].length;
    const blockEnd = next?.index ?? raw.length;
    const block = raw.slice(blockStart, blockEnd).trim();
    const username = current[1];
    const userId = current[2];
    if (!username || !userId) {
      continue;
    }
    const messageContent = block.replace(MESSAGE_ID_TRAILER_RE, "").trim();
    if (!messageContent) {
      continue;
    }
    segments.push({
      role: "user",
      content:
        messageContent.toUpperCase() === "HEARTBEAT_OK" ? "Heartbeat acknowledged." : messageContent,
      specialFormat: messageContent.toUpperCase() === "HEARTBEAT_OK" ? "heartbeat-ok" : undefined,
      origin: { provider: "discord", from: username, accountId: userId },
    });
  }
  return segments;
}

type AutoRouterStripResult = {
  content: string;
  extractedOrigin?: MessageOrigin;
  routedModel?: string;
};

function stripAutoRouterContext(content: string): AutoRouterStripResult {
  const tierMatch = content.match(/^You are running as (\w+) tier\b/i);
  if (!tierMatch) {
    return { content };
  }
  const routedModel = tierMatch[1];
  let extractedOrigin: MessageOrigin | undefined;
  const labelMatch = content.match(/"conversation_label"\s*:\s*"([^"]+)"/);
  if (labelMatch?.[1]) {
    const idMatch = labelMatch[1].match(/^(\S+)\s+user\s+id:(\S+)/i);
    if (idMatch?.[1] && idMatch[2]) {
      extractedOrigin = { from: idMatch[1], accountId: idMatch[2] };
    }
  }
  const systemLineMatch = content.match(/^(System:\s*\[[^\]]*\].*)/m);
  const systemPrefix = systemLineMatch?.[1] ? systemLineMatch[1] + "\n" : "";
  const convInfoRe =
    /^[\s\S]*?Conversation info[^\n]*:\s*(?:```(?:\w+)?\s*)?\{[\s\S]*?\}(?:\s*```)?\s*/;
  const convMatch = content.match(convInfoRe);
  if (convMatch) {
    const remainder = content.slice(convMatch[0].length).trim();
    return { content: (systemPrefix + remainder).trim(), extractedOrigin, routedModel };
  }
  const transcriptStart = content.search(/^\[[^\]]+\]\s+\[[^\]]*user id:[^\]]+\]/m);
  if (transcriptStart >= 0) {
    const remainder = content.slice(transcriptStart).trim();
    return { content: (systemPrefix + remainder).trim(), extractedOrigin, routedModel };
  }
  const lines = content.split("\n");
  let cutAfter = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^\*\*\w+ IS correct for:\*\*/.test(line) ||
      line.startsWith('**Call route_redo early') ||
      /^If you call route_redo\b/i.test(line) ||
      /route_redo\(\{/.test(line)
    ) {
      cutAfter = i;
    }
  }
  if (cutAfter >= 0) {
    const remainder = lines.slice(cutAfter + 1).join("\n").trim();
    return { content: (systemPrefix + remainder).trim(), extractedOrigin, routedModel };
  }
  return { content, extractedOrigin, routedModel };
}

function parseUserContent(content: string): ParsedContentResult {
  const metadataPrefixes: string[] = [];
  const strippedMetadata: string[] = [];
  let remaining = content;

  while (true) {
    const match = remaining.match(METADATA_PREFIX_RE);
    if (!match?.[1]) {
      break;
    }
    metadataPrefixes.push(match[1]);
    remaining = remaining.slice(match[0].length);
  }

  let parsedOrigin: MessageOrigin | undefined;
  for (const metadata of metadataPrefixes) {
    const providerMatch = metadata.match(PROVIDER_BRACKET_RE);
    if (providerMatch?.[1] && providerMatch[2]) {
      const providerRaw = providerMatch[1].toLowerCase();
      if (BRACKET_PROVIDERS.has(providerRaw)) {
        if (!parsedOrigin) {
          parsedOrigin = {
            provider: providerRaw,
            from: providerMatch[2],
            accountId: providerMatch[3] as string | undefined,
          };
        }
        continue;
      }
    }
    strippedMetadata.push(metadata);
  }

  const hasAutoRouter = metadataPrefixes.some((p) => /^\[Auto-Router\]$/i.test(p));
  if (hasAutoRouter) {
    const stripped = stripAutoRouterContext(remaining.trim());
    remaining = stripped.content;
    while (true) {
      const match = remaining.match(METADATA_PREFIX_RE);
      if (!match?.[1]) {
        break;
      }
      const metadata = match[1];
      const providerMatch = metadata.match(PROVIDER_BRACKET_RE);
      if (providerMatch?.[1] && providerMatch[2]) {
        const providerRaw = providerMatch[1].toLowerCase();
        if (BRACKET_PROVIDERS.has(providerRaw)) {
          if (!parsedOrigin) {
            parsedOrigin = {
              provider: providerRaw,
              from: providerMatch[2],
              accountId: providerMatch[3] as string | undefined,
            };
          }
          remaining = remaining.slice(match[0].length);
          continue;
        }
      }
      strippedMetadata.push(metadata);
      remaining = remaining.slice(match[0].length);
    }
    if (!parsedOrigin && stripped.extractedOrigin) {
      parsedOrigin = stripped.extractedOrigin;
    }
    if (stripped.routedModel) {
      parsedOrigin ??= { provider: "auto-router" };
      parsedOrigin.routedModel = stripped.routedModel;
    }
    const arIdx = strippedMetadata.findIndex((p) => /^\[Auto-Router\]$/i.test(p));
    if (arIdx >= 0) {
      strippedMetadata.splice(arIdx, 1);
    }
  }

  const trimmedRemaining = remaining.trim();
  const discordStart = trimmedRemaining.search(DISCORD_HEADER_DETECT_RE);
  const hasDiscordBlocks = discordStart >= 0;
  const hasSystemPrefix = SYSTEM_PREFIX_RE.test(trimmedRemaining);

  if (hasSystemPrefix || hasDiscordBlocks) {
    const segments: ParsedUserSegment[] = [];
    if (hasSystemPrefix) {
      const systemBlock =
        hasDiscordBlocks && discordStart > 0
          ? trimmedRemaining.slice(0, discordStart).trim()
          : trimmedRemaining;
      const normalizedSystem = normalizeSystemBlock(systemBlock);
      segments.push({
        role: "user",
        content: normalizedSystem.content,
        specialFormat: normalizedSystem.specialFormat,
        origin: { provider: "system", from: "System", label: "System" },
      });
    }
    if (hasDiscordBlocks) {
      const discordRaw = trimmedRemaining.slice(Math.max(0, discordStart)).trim();
      segments.push(...parseDiscordSegments(discordRaw));
    }
    if (segments.length > 0) {
      if (strippedMetadata.length > 0) {
        const first = segments[0];
        if (first) {
          first.metadataPrefixes = strippedMetadata;
        }
      }
      const first = segments[0];
      return {
        content: first.content,
        origin: first.origin,
        metadataPrefixes: first.metadataPrefixes,
        specialFormat: first.specialFormat,
        segments,
      };
    }
  }

  const contentWithoutMessageId = trimmedRemaining.replace(MESSAGE_ID_TRAILER_RE, "").trim();
  return {
    content:
      contentWithoutMessageId ||
      (metadataPrefixes.length > 0 ? remaining.trimStart() : content),
    origin: parsedOrigin,
    metadataPrefixes: strippedMetadata.length > 0 ? strippedMetadata : undefined,
    specialFormat:
      contentWithoutMessageId.toUpperCase() === "HEARTBEAT_OK" ? "heartbeat-ok" : undefined,
  };
}

function parseAssistantContent(content: string): ParsedContentResult {
  const stripped = stripAssistantDirectives(content);
  const trimmed = stripped.content;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    const parsedOrigin: MessageOrigin | undefined =
      stripped.explicitTarget || stripped.replyToCurrent
        ? {
            to:
              stripped.explicitTarget ??
              (stripped.replyToCurrent ? REPLY_TO_CURRENT_TARGET : undefined),
          }
        : undefined;
    return {
      content:
        trimmed.toUpperCase() === "HEARTBEAT_OK" ? "Heartbeat acknowledged." : stripped.content,
      specialFormat: trimmed.toUpperCase() === "HEARTBEAT_OK" ? "heartbeat-ok" : undefined,
      origin: parsedOrigin,
    };
  }
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.action === "send" && typeof obj.channel === "string") {
      const message = trimToUndefined(obj.message);
      const messageDirectives = stripAssistantDirectives(message ?? "");
      return {
        content: messageDirectives.content || trimmed,
        origin: {
          provider: obj.channel,
          to:
            messageDirectives.explicitTarget ??
            normalizeSendTarget(obj.target) ??
            (messageDirectives.replyToCurrent ? REPLY_TO_CURRENT_TARGET : undefined),
        },
      };
    }
  } catch {
    // Not valid JSON action payload
  }
  return { content };
}

export function formatRelativeTimestamp(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return new Date(ms).toLocaleDateString();
}

function mergeOrigins(
  primary?: MessageOrigin,
  fallback?: MessageOrigin,
): MessageOrigin | undefined {
  return mergeMessageOrigins(primary, fallback);
}

function guessImageMime(base64: string): string {
  if (base64.startsWith("/9j/")) {
    return "image/jpeg";
  }
  if (base64.startsWith("iVBORw0KGgo")) {
    return "image/png";
  }
  if (base64.startsWith("R0lGOD")) {
    return "image/gif";
  }
  if (base64.startsWith("UklGR")) {
    return "image/webp";
  }
  return "image/png";
}

function extractImages(m: Record<string, unknown>): ChatImage[] | undefined {
  const images: ChatImage[] = [];
  const candidates = m.attachments ?? m.images;
  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const a = item as Record<string, unknown>;
      const mimeType =
        typeof a.mimeType === "string"
          ? a.mimeType
          : typeof a.mime_type === "string"
            ? a.mime_type
            : "";
      const data =
        typeof a.content === "string"
          ? a.content
          : typeof a.data === "string"
            ? a.data
            : "";
      if (!mimeType.startsWith("image/") || !data) {
        continue;
      }
      images.push({
        mimeType,
        data,
        fileName:
          typeof a.fileName === "string"
            ? a.fileName
            : typeof a.file_name === "string"
              ? a.file_name
              : undefined,
      });
    }
  }
  const content = m.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const b = block as Record<string, unknown>;
      if (b.type !== "image") {
        continue;
      }
      if (typeof b.data === "string" && b.data.length > 0) {
        const mimeType =
          typeof b.media_type === "string"
            ? b.media_type
            : typeof b.mimeType === "string"
              ? b.mimeType
              : guessImageMime(b.data);
        images.push({ mimeType, data: b.data });
        continue;
      }
      const source = b.source as Record<string, unknown> | undefined;
      if (source && typeof source === "object") {
        if (source.type === "base64" && typeof source.data === "string") {
          const mediaType =
            typeof source.media_type === "string" ? source.media_type : "image/png";
          images.push({ mimeType: mediaType, data: source.data });
        } else if (source.type === "url" && typeof source.url === "string") {
          images.push({
            mimeType: typeof source.media_type === "string" ? source.media_type : "image/png",
            data: "",
            previewUrl: source.url,
          });
        }
      }
    }
  }
  return images.length > 0 ? images : undefined;
}

export function historyToMessages(rawMessages: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const m = raw as Record<string, unknown>;
    const role = normalizeRole(m.role);
    const timestamp = typeof m.timestamp === "number" ? m.timestamp : Date.now();
    const text = extractText(raw) ?? "";
    const tools = extractToolItems(raw);
    const structuredOrigin = extractOrigin(m);
    const historyImages = extractImages(m);
    const parsed = parseContentOrigin(text, role);
    const parsedSegments = role === "user" ? parsed.segments : undefined;

    if (parsedSegments && parsedSegments.length > 0) {
      for (const segment of parsedSegments) {
        if (segment.content.trim().length === 0) {
          continue;
        }
        const segmentOrigin =
          segment.role === "user"
            ? mergeOrigins(segment.origin, structuredOrigin)
            : mergeOrigins(structuredOrigin, segment.origin);
        out.push({
          id: makeId(),
          role: segment.role,
          content: segment.content,
          timestamp,
          metadataPrefixes: segment.metadataPrefixes,
          specialFormat: segment.specialFormat,
          origin: segmentOrigin,
          images: historyImages,
        });
      }
    } else {
      const displayContent = parsed.content;
      const displayOrigin =
        role === "user"
          ? mergeOrigins(parsed.origin, structuredOrigin)
          : mergeOrigins(structuredOrigin, parsed.origin);
      if (displayContent.trim().length > 0) {
        out.push({
          id: makeId(),
          role,
          content: displayContent,
          timestamp,
          metadataPrefixes: parsed.metadataPrefixes,
          specialFormat: parsed.specialFormat,
          origin: displayOrigin,
          images: historyImages,
        });
      }
    }

    let lastMessageSendIndex: number | null = null;
    for (const item of tools) {
      const toolName = item.name.toLowerCase();
      if (toolName === "message") {
        if (item.kind === "call") {
          const parsedSend = parseMessageToolCallPayload(item.payload);
          if (parsedSend && (parsedSend.content || parsedSend.origin)) {
            out.push({
              id: makeId(),
              role: "assistant",
              content: parsedSend.content ?? "",
              timestamp,
              origin: parsedSend.origin,
            });
            lastMessageSendIndex = out.length - 1;
            continue;
          }
        } else {
          const parsedSendResult = parseMessageToolResultPayload(item.payload);
          if (parsedSendResult?.origin) {
            if (lastMessageSendIndex != null) {
              const existing = out[lastMessageSendIndex];
              if (existing) {
                out[lastMessageSendIndex] = {
                  ...existing,
                  origin: mergeOrigins(parsedSendResult.origin, existing.origin),
                };
              }
            } else {
              out.push({
                id: makeId(),
                role: "assistant",
                content: "",
                timestamp,
                origin: parsedSendResult.origin,
              });
            }
            continue;
          }
        }
      }
      if (item.kind === "call") {
        out.push({
          id: makeId(),
          role: "tool",
          content: "",
          timestamp,
          toolCall: { name: item.name, input: item.payload },
        });
      } else {
        out.push({
          id: makeId(),
          role: "tool",
          content: "",
          timestamp,
          toolResult: { name: item.name, output: item.payload },
        });
      }
    }
  }
  return out;
}
