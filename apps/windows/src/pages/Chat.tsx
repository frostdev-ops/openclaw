import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useGateway } from "../gateway/context";
import { useGatewayEvent } from "../hooks/useGatewayEvent";
import { Badge } from "../components/common/Badge";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/common/Button";
import { ChatMessageBubble } from "../components/chat/ChatMessageBubble";
import { ChatStatusBar } from "../components/chat/ChatStatusBar";
import {
  historyToMessages,
  makeId,
  extractText,
  stripAssistantDirectives,
} from "../components/chat/utils";
import {
  loadPersistedChatState,
  savePersistedChatState,
} from "../components/chat/persistence";
import type {
  ChatMessage,
  ChatImage,
  ChatEventPayload,
} from "../components/chat/types";
import type { GatewaySessionRow } from "../gateway/types";
import type { PageId, PageState } from "../types";
import { cn } from "../lib/utils";
import {
  MessageSquare,
  Send,
  Square,
  RefreshCw,
  ArrowDown,
  ChevronDown,
  Eye,
  EyeOff,
  ImagePlus,
  X,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const HISTORY_REFRESH_DELAY_MS = 300;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const LOCAL_CLEAR_NOTICE =
  "Local view cleared. Refresh/history may repopulate persisted session messages.";

function fileToBase64(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`Not an image: ${file.type}`));
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      reject(
        new Error(
          `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 5 MB)`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result as string;
      const base64 = result.replace(/^data:[^;]+;base64,/, "");
      resolve({
        mimeType: file.type,
        data: base64,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
      });
    });
    reader.addEventListener("error", () => reject(new Error("Failed to read file")));
    reader.readAsDataURL(file);
  });
}

function revokeImageUrls(images: ChatImage[]): void {
  for (const image of images) {
    if (image.previewUrl) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatProps {
  onNavigate: (page: PageId, state?: PageState) => void;
}

export function Chat({ onNavigate: _onNavigate }: ChatProps) {
  const { rpc, status } = useGateway();
  const connected = status.state === "connected";

  // Persistence
  const gatewayUrl = "windows-app";
  const persistedState = useMemo(() => loadPersistedChatState(gatewayUrl), []);

  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(persistedState?.draftText ?? "");
  const [sending, setSending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(persistedState?.sessionKey ?? "main");
  const [sessions, setSessions] = useState<GatewaySessionRow[]>([]);
  const [showInternals, setShowInternals] = useState(
    persistedState?.showInternals ?? false,
  );
  const [clearedAtBySession, setClearedAtBySession] = useState<Record<string, number>>(
    persistedState?.clearedAtBySession ?? {},
  );
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);

  // Images
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Refs for streaming
  const activeRunRef = useRef<string | null>(null);
  const streamingMessageRef = useRef<Map<string, string>>(new Map());

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // --- Persistence effects ---
  useEffect(() => {
    savePersistedChatState(gatewayUrl, {
      version: 1,
      sessionKey,
      showInternals,
      draftText: input,
      clearedAtBySession,
    });
  }, [sessionKey, showInternals, input, clearedAtBySession]);

  // --- Load sessions list ---
  const loadSessions = useCallback(async () => {
    if (!connected) {
      return;
    }
    const res = await rpc<{ sessions: GatewaySessionRow[] }>("sessions.list");
    if (res.ok && res.payload?.sessions) {
      setSessions(res.payload.sessions);
    }
  }, [rpc, connected]);

  useEffect(() => {
    void loadSessions();
    const interval = setInterval(() => void loadSessions(), 30_000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  // --- Load chat history ---
  const loadHistory = useCallback(async () => {
    if (!connected) {
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await rpc<{ messages?: unknown }>("chat.history", {
        sessionKey,
        limit: 200,
      });
      if (res.ok && res.payload) {
        const rawMessages = Array.isArray(res.payload.messages)
          ? res.payload.messages
          : [];
        setMessages(historyToMessages(rawMessages));
      }
    } catch {
      // Silent fail
    } finally {
      setHistoryLoading(false);
    }
  }, [rpc, sessionKey, connected]);

  useEffect(() => {
    if (connected) {
      void loadHistory();
    }
  }, [connected, loadHistory]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isAtBottom) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Scroll tracking
  const checkIfAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const handler = () => checkIfAtBottom();
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [checkIfAtBottom]);

  // --- Gateway event: chat streaming ---
  useGatewayEvent<ChatEventPayload>("chat", (payload) => {
    const state = typeof payload.state === "string" ? payload.state : "";
    const runId = typeof payload.runId === "string" ? payload.runId : undefined;
    const payloadSessionKey =
      typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;

    // Only process events for our session
    if (payloadSessionKey && payloadSessionKey !== sessionKey) {
      return;
    }

    if (state === "delta") {
      // Streaming delta
      const rawMessage = payload.message;
      const text = typeof rawMessage === "string" ? rawMessage : extractText(rawMessage);
      if (!text || !runId) {
        return;
      }
      const existing = streamingMessageRef.current.get(runId) ?? "";
      const updated = existing + text;
      streamingMessageRef.current.set(runId, updated);
      activeRunRef.current = runId;
      setActiveRunId(runId);

      setMessages((prev) => {
        const streamMsgId = `streaming-${runId}`;
        const idx = prev.findIndex((m) => m.id === streamMsgId);
        const directives = stripAssistantDirectives(updated);
        const msg: ChatMessage = {
          id: streamMsgId,
          role: "assistant",
          content: directives.content,
          timestamp: Date.now(),
          streaming: true,
          runId,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = msg;
          return next;
        }
        return [...prev, msg];
      });
    } else if (state === "final" || state === "aborted") {
      // Run complete — refresh history
      if (runId) {
        streamingMessageRef.current.delete(runId);
      }
      setActiveRunId(null);
      activeRunRef.current = null;
      setSending(false);
      setTimeout(() => void loadHistory(), HISTORY_REFRESH_DELAY_MS);
    } else if (state === "error") {
      const errorMessage =
        typeof payload.errorMessage === "string"
          ? payload.errorMessage
          : "An error occurred";
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "system",
          content: errorMessage,
          timestamp: Date.now(),
        },
      ]);
      setActiveRunId(null);
      activeRunRef.current = null;
      setSending(false);
    }
  });

  // --- Send message ---
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) {
      return;
    }
    if (!connected || sending) {
      return;
    }

    // Add optimistic user message
    const userMsg: ChatMessage = {
      id: makeId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      images:
        pendingImages.length > 0
          ? pendingImages.map((img) => ({ ...img }))
          : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    const attachments =
      pendingImages.length > 0
        ? pendingImages.map((img) => ({
            mimeType: img.mimeType,
            data: img.data,
            fileName: img.fileName,
          }))
        : undefined;

    revokeImageUrls(pendingImages);
    setPendingImages([]);

    try {
      const res = await rpc("chat.send", {
        sessionKey,
        message: text,
        deliver: false,
        attachments,
      });
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "system",
            content: res.error?.message ?? "Failed to send message",
            timestamp: Date.now(),
          },
        ]);
        setSending(false);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "system",
          content: err instanceof Error ? err.message : "Send failed",
          timestamp: Date.now(),
        },
      ]);
      setSending(false);
    }
  }, [input, pendingImages, connected, sending, rpc, sessionKey]);

  // --- Abort ---
  const handleAbort = useCallback(async () => {
    if (!activeRunId) {
      return;
    }
    await rpc("chat.abort", { sessionKey, runId: activeRunId });
  }, [rpc, sessionKey, activeRunId]);

  // --- Clear ---
  const handleClear = useCallback(() => {
    setClearedAtBySession((prev) => ({ ...prev, [sessionKey]: Date.now() }));
    setMessages([
      {
        id: makeId(),
        role: "system",
        content: LOCAL_CLEAR_NOTICE,
        timestamp: Date.now(),
      },
    ]);
  }, [sessionKey]);

  // --- Key handler ---
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // --- Image handling ---
  const handleImageSelect = useCallback(async (files: FileList | null) => {
    if (!files) {
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) {
        continue;
      }
      try {
        const img = await fileToBase64(file);
        setPendingImages((prev) => [...prev, img]);
      } catch (err) {
        console.warn("Image attach failed:", err);
      }
    }
  }, []);

  const removeImage = useCallback((idx: number) => {
    setPendingImages((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // --- Filter messages by clearedAt ---
  const clearedAt = clearedAtBySession[sessionKey] ?? 0;
  const visibleMessages = useMemo(() => {
    if (clearedAt <= 0) {
      return messages;
    }
    return messages.filter((m) => m.timestamp >= clearedAt);
  }, [messages, clearedAt]);

  // --- Filter internals ---
  const displayMessages = useMemo(() => {
    if (showInternals) {
      return visibleMessages;
    }
    return visibleMessages.filter((m) => m.role !== "tool" && m.role !== "system");
  }, [visibleMessages, showInternals]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top controls */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-800 bg-neutral-950/50">
        {/* Session selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSessionDropdownOpen((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800/60 border border-white/10 text-sm text-neutral-200 hover:bg-neutral-800/80 transition-colors"
          >
            <MessageSquare size={14} className="text-primary-400" />
            <span className="truncate max-w-[180px]">
              {sessions.find((s) => s.key === sessionKey)?.label ?? sessionKey}
            </span>
            <ChevronDown size={12} className="text-neutral-500" />
          </button>

          <AnimatePresence>
            {sessionDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto rounded-lg bg-neutral-900 border border-white/10 shadow-xl z-50"
              >
                {sessions.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSessionKey(s.key);
                      setSessionDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm hover:bg-white/[0.06] transition-colors",
                      s.key === sessionKey
                        ? "text-primary-300 bg-primary-500/10"
                        : "text-neutral-300",
                    )}
                  >
                    <div className="truncate font-medium">
                      {s.label ?? s.displayName ?? s.key}
                    </div>
                    {(s.label || s.displayName) && (
                      <div className="text-[10px] text-neutral-500 font-mono truncate">
                        {s.key}
                      </div>
                    )}
                  </button>
                ))}
                {sessions.length === 0 && (
                  <div className="px-3 py-4 text-sm text-neutral-500 text-center">
                    No sessions available
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Close dropdown on outside click */}
        {sessionDropdownOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setSessionDropdownOpen(false)}
          />
        )}

        <div className="flex-1" />

        {/* Show/hide internals */}
        <Button
          variant="ghost"
          onClick={() => setShowInternals((p) => !p)}
          className="!px-2"
          title={showInternals ? "Hide internals" : "Show internals"}
        >
          {showInternals ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>

        {/* Clear */}
        <Button variant="ghost" onClick={handleClear} className="!px-2" title="Clear chat view">
          <Trash2 size={14} />
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          onClick={() => void loadHistory()}
          disabled={historyLoading}
          className="!px-2"
          title="Refresh history"
        >
          <RefreshCw size={14} className={cn(historyLoading && "animate-spin")} />
        </Button>

        {/* Streaming indicator */}
        {activeRunId && (
          <Badge variant="primary">
            <span className="flex items-center gap-1">
              <Spinner size={10} />
              Streaming
            </span>
          </Badge>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 relative">
        {historyLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size={28} />
          </div>
        ) : displayMessages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages"
            description="Start a conversation by typing below."
          />
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto py-4">
            {displayMessages.map((msg, idx) => (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                prevMessage={displayMessages[idx - 1]}
                showInternals={showInternals}
              />
            ))}
          </div>
        )}

        {!isAtBottom && displayMessages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setIsAtBottom(true);
              scrollToBottom();
            }}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium shadow-lg transition-colors z-10"
          >
            <ArrowDown size={14} />
            Bottom
          </button>
        )}
      </div>

      {/* Status bar */}
      <ChatStatusBar sessionKey={sessionKey} />

      {/* Pending images */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 px-4 py-2 border-t border-white/10 bg-neutral-950/50 overflow-x-auto">
          {pendingImages.map((img, idx) => (
            <div key={idx} className="relative shrink-0">
              <img
                src={img.previewUrl ?? `data:${img.mimeType};base64,${img.data}`}
                alt={img.fileName ?? `Image ${idx + 1}`}
                className="h-16 w-16 object-cover rounded-lg border border-white/10"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 border border-white/10 text-neutral-400 hover:text-white hover:bg-error-600 transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-white/10 bg-neutral-950/50 px-4 py-3">
        <div className="flex items-end gap-2">
          {/* Image attach */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center h-10 w-10 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors shrink-0"
            title="Attach image"
          >
            <ImagePlus size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleImageSelect(e.target.files)}
          />

          {/* Textarea */}
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected ? "Type a message..." : "Disconnected"}
              disabled={!connected}
              rows={1}
              className="w-full resize-none rounded-xl bg-neutral-800/60 border border-white/10 px-4 py-2.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary-500/50 max-h-32 overflow-y-auto"
              style={{ minHeight: "42px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
              }}
            />
          </div>

          {/* Send / Abort */}
          {activeRunId ? (
            <Button
              variant="danger"
              onClick={() => void handleAbort()}
              className="shrink-0 !px-3"
              title="Abort"
            >
              <Square size={16} />
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void handleSend()}
              disabled={
                !connected || sending || (!input.trim() && pendingImages.length === 0)
              }
              loading={sending && !activeRunId}
              className="shrink-0 !px-3"
              title="Send"
            >
              <Send size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
