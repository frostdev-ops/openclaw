import type { ChatImage } from "./types";

const CHAT_STATE_STORAGE_PREFIX = "openclaw-chat-state-v1";

export type PersistedChatAttachmentMeta = {
  fileName?: string;
  mimeType: string;
  approxBytes?: number;
};

export type PersistedChatState = {
  version: 1;
  sessionKey?: string;
  showInternals?: boolean;
  selectedWebIdentityId?: string;
  draftText?: string;
  draftAttachmentsMeta?: PersistedChatAttachmentMeta[];
  clearedAtBySession?: Record<string, number>;
};

function hashScope(scope: string): string {
  let hash = 0;
  for (let i = 0; i < scope.length; i++) {
    hash = ((hash << 5) - hash + scope.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getStorageKey(gatewayUrl: string): string {
  const scope = gatewayUrl.trim() || "default";
  return `${CHAT_STATE_STORAGE_PREFIX}:${hashScope(scope)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function sanitizeAttachmentMeta(value: unknown): PersistedChatAttachmentMeta | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  if (!mimeType) {
    return null;
  }
  return {
    mimeType,
    fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    approxBytes:
      typeof record.approxBytes === "number" && Number.isFinite(record.approxBytes)
        ? Math.max(0, Math.floor(record.approxBytes))
        : undefined,
  };
}

function sanitizeClearedMap(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      continue;
    }
    out[key] = Math.floor(raw);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function loadPersistedChatState(gatewayUrl: string): PersistedChatState | null {
  try {
    const raw = localStorage.getItem(getStorageKey(gatewayUrl));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record || record.version !== 1) {
      return null;
    }
    const draftAttachmentsMeta = Array.isArray(record.draftAttachmentsMeta)
      ? record.draftAttachmentsMeta
          .map((entry) => sanitizeAttachmentMeta(entry))
          .filter((entry): entry is PersistedChatAttachmentMeta => entry !== null)
      : undefined;
    return {
      version: 1,
      sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : undefined,
      showInternals: typeof record.showInternals === "boolean" ? record.showInternals : undefined,
      selectedWebIdentityId:
        typeof record.selectedWebIdentityId === "string" ? record.selectedWebIdentityId : undefined,
      draftText: typeof record.draftText === "string" ? record.draftText : undefined,
      draftAttachmentsMeta:
        draftAttachmentsMeta && draftAttachmentsMeta.length > 0 ? draftAttachmentsMeta : undefined,
      clearedAtBySession: sanitizeClearedMap(record.clearedAtBySession),
    };
  } catch {
    return null;
  }
}

export function savePersistedChatState(gatewayUrl: string, state: PersistedChatState): void {
  localStorage.setItem(getStorageKey(gatewayUrl), JSON.stringify(state));
}

export function toPersistedAttachmentMeta(images: ChatImage[]): PersistedChatAttachmentMeta[] {
  return images.reduce<PersistedChatAttachmentMeta[]>((acc, image) => {
    const mimeType = image.mimeType.trim();
    if (!mimeType) {
      return acc;
    }
    acc.push({
      fileName: image.fileName,
      mimeType,
      approxBytes: Math.floor((image.data.length * 3) / 4),
    });
    return acc;
  }, []);
}
