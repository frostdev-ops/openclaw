import { useState, useEffect, useCallback, useRef } from "react";
import { useGateway } from "../gateway/context";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/common/Button";
import { ChatMessageBubble } from "../components/chat/ChatMessageBubble";
import { historyToMessages } from "../components/chat/utils";
import type { ChatMessage } from "../components/chat/types";
import { FadeIn } from "../components/motion/FadeIn";
import { cn, formatTokens } from "../lib/utils";
import {
  ArrowLeft,
  MessageSquare,
  RefreshCw,
  ArrowDown,
} from "lucide-react";
import type { GatewaySessionRow } from "../gateway/types";

interface SessionReplayProps {
  sessionKey: string;
  onBack: () => void;
}

export function SessionReplay({ sessionKey, onBack }: SessionReplayProps) {
  const { rpc, status } = useGateway();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<GatewaySessionRow | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (status.state !== "connected") {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<{ messages?: unknown }>("chat.history", {
        sessionKey,
        limit: 500,
      });
      if (res.ok && res.payload) {
        const rawMessages = Array.isArray(res.payload.messages) ? res.payload.messages : [];
        setMessages(historyToMessages(rawMessages));
      } else {
        setError(res.error?.message ?? "Failed to load history");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rpc, sessionKey, status.state]);

  // Load session info
  useEffect(() => {
    if (status.state !== "connected") {
      return;
    }
    void (async () => {
      try {
        const res = await rpc<{ sessions: GatewaySessionRow[] }>("sessions.list");
        if (res.ok && res.payload?.sessions) {
          const match = res.payload.sessions.find((s) => s.key === sessionKey);
          if (match) {
            setSessionInfo(match);
          }
        }
      } catch {
        // Best-effort
      }
    })();
  }, [rpc, sessionKey, status.state]);

  useEffect(() => {
    if (status.state === "connected") {
      void loadHistory();
    }
  }, [status.state, loadHistory]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [loading, messages.length, scrollToBottom]);

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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-800">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessageSquare size={18} className="text-primary-400 shrink-0" />
          <h1 className="text-sm font-semibold text-neutral-100 truncate">
            {sessionInfo?.label ?? sessionInfo?.displayName ?? sessionKey}
          </h1>
          {sessionInfo?.kind && <Badge variant="info">{sessionInfo.kind}</Badge>}
          {sessionInfo?.model && (
            <span className="text-xs text-neutral-500 font-mono">{sessionInfo.model}</span>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={() => void loadHistory()}
          disabled={loading}
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Session info sidebar */}
        {sessionInfo && (
          <FadeIn className="w-72 shrink-0 border-r border-neutral-800 p-4 overflow-y-auto hidden lg:block">
            <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Session Info
            </h2>
            <div className="space-y-2 text-xs">
              {(
                [
                  ["Key", sessionInfo.key],
                  ["Kind", sessionInfo.kind],
                  ["Model", sessionInfo.model],
                  ["Provider", sessionInfo.modelProvider],
                  ["Surface", sessionInfo.surface],
                  [
                    "Input Tokens",
                    sessionInfo.inputTokens != null
                      ? formatTokens(sessionInfo.inputTokens)
                      : undefined,
                  ],
                  [
                    "Output Tokens",
                    sessionInfo.outputTokens != null
                      ? formatTokens(sessionInfo.outputTokens)
                      : undefined,
                  ],
                  [
                    "Total Tokens",
                    sessionInfo.totalTokens != null
                      ? formatTokens(sessionInfo.totalTokens)
                      : undefined,
                  ],
                  [
                    "Updated",
                    sessionInfo.updatedAtMs
                      ? new Date(sessionInfo.updatedAtMs).toLocaleString()
                      : sessionInfo.updatedAt,
                  ],
                ] as [string, string | number | undefined][]
              ).map(([label, value]) =>
                value ? (
                  <div key={label} className="flex items-baseline gap-2">
                    <span className="text-neutral-500 w-24 shrink-0">{label}</span>
                    <span className="text-neutral-200 font-mono break-all">{value}</span>
                  </div>
                ) : null,
              )}
            </div>
          </FadeIn>
        )}

        {/* Conversation */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center flex-1">
              <Spinner size={28} />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center flex-1">
              <Card>
                <p className="text-sm text-error-400">{error}</p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void loadHistory()}
                >
                  Retry
                </Button>
              </Card>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No messages"
              description="This session has no chat history."
            />
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
              {messages.map((msg, idx) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  prevMessage={messages[idx - 1]}
                />
              ))}
            </div>
          )}

          {!isAtBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsAtBottom(true);
                scrollToBottom();
              }}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium shadow-lg transition-colors"
            >
              <ArrowDown size={14} />
              Bottom
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
