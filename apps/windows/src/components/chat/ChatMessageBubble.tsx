import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { Info, Send as SendIcon, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ToolCallCard } from "./ToolCallCard";
import { OriginBadge } from "./OriginBadge";
import { ChatAvatar } from "./ChatAvatar";
import { MarkdownContent } from "./MarkdownContent";
import { formatTimestamp } from "./utils";
import type { ChatMessage, ChatImage } from "./types";

const TWO_MINUTES = 2 * 60 * 1000;

function shouldGroup(prev: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!prev) {
    return false;
  }
  if (prev.role !== current.role) {
    return false;
  }
  if (Math.abs(current.timestamp - prev.timestamp) > TWO_MINUTES) {
    return false;
  }
  if (prev.origin?.from !== current.origin?.from) {
    return false;
  }
  return true;
}

function getDisplayName(message: ChatMessage): string {
  const { role, origin } = message;
  if (role === "user") {
    return origin?.from ?? "User";
  }
  if (role === "assistant") {
    return "OpenClaw";
  }
  return role;
}

function imageToSrc(img: ChatImage): string {
  if (img.previewUrl) {
    return img.previewUrl;
  }
  return `data:${img.mimeType};base64,${img.data}`;
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-zoom-out"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
          aria-label="Close preview"
        >
          <X size={20} />
        </button>
        <motion.img
          src={src}
          alt={alt}
          className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl cursor-default"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        />
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function ImageGrid({ images }: { images: ChatImage[] }) {
  const [lightboxImg, setLightboxImg] = useState<{ src: string; alt: string } | null>(null);
  const closeLightbox = useCallback(() => setLightboxImg(null), []);

  return (
    <>
      <div
        className={cn(
          "mt-1.5 gap-1.5",
          images.length === 1 ? "flex" : "grid grid-cols-2",
        )}
      >
        {images.map((img, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() =>
              setLightboxImg({ src: imageToSrc(img), alt: img.fileName ?? `Image ${idx + 1}` })
            }
            className="rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary-400/40"
          >
            <img
              src={imageToSrc(img)}
              alt={img.fileName ?? `Image ${idx + 1}`}
              className="max-h-64 object-cover rounded-xl cursor-pointer hover:brightness-110 transition-[filter]"
            />
          </button>
        ))}
      </div>
      {lightboxImg && (
        <ImageLightbox src={lightboxImg.src} alt={lightboxImg.alt} onClose={closeLightbox} />
      )}
    </>
  );
}

export function ChatMessageBubble({
  message,
  prevMessage,
  showInternals = false,
}: {
  message: ChatMessage;
  prevMessage?: ChatMessage;
  showInternals?: boolean;
}) {
  const {
    role,
    content,
    timestamp,
    toolCall,
    toolResult,
    streaming,
    origin,
    metadataPrefixes,
    senderColor,
    specialFormat,
    images,
  } = message;
  const grouped = shouldGroup(prevMessage, message);
  const displayName = getDisplayName(message);
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isOutbound = isAssistant && origin?.to != null;
  const bubbleBaseClass =
    "rounded-[20px] px-3.5 py-2.5 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_30px_rgba(2,6,23,0.38)]";
  const userBubbleClass =
    "bg-[linear-gradient(160deg,rgba(39,39,42,0.58),rgba(24,24,27,0.36))]";
  const assistantBubbleClass =
    "bg-[linear-gradient(160deg,rgba(14,165,233,0.2),rgba(15,23,42,0.44))]";
  const contentColumnClass =
    "flex-1 min-w-0 max-w-[min(84ch,calc(100vw-6rem))] sm:max-w-[min(90ch,calc(100vw-10rem))]";
  const metadataLabel = metadataPrefixes
    ?.map((entry) => entry.replace(/^\[|\]$/g, "").split(/\s+/)[0]?.trim().toLowerCase())
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, idx, arr) => arr.indexOf(entry) === idx)
    .join(" + ");
  const isSystemNote = specialFormat === "system-note" || specialFormat === "heartbeat-request";
  const displayContent =
    !showInternals && isSystemNote
      ? "\u2764\uFE0F"
      : !showInternals && specialFormat === "heartbeat-ok"
        ? "Heartbeat check complete."
        : content;

  // System messages: centered pill
  if (role === "system") {
    return (
      <motion.div
        className="flex justify-center my-3 px-2.5 sm:px-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-neutral-950/75 border border-white/10 max-w-[calc(100%-1.25rem)] sm:max-w-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <Info size={14} className="text-neutral-500 shrink-0" />
          <span className="text-xs text-neutral-400 leading-relaxed">{content}</span>
        </div>
      </motion.div>
    );
  }

  // Tool calls: indented under avatar column
  if (role === "tool") {
    return (
      <motion.div
        className="pl-8 sm:pl-[60px] pr-2.5 sm:pr-4 my-1"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        <ToolCallCard toolCall={toolCall} toolResult={toolResult} />
        {content && <p className="text-xs text-neutral-500 mt-1 whitespace-pre-wrap">{content}</p>}
      </motion.div>
    );
  }

  // Grouped message: no avatar, no header
  if (grouped) {
    return (
      <motion.div
        className="group flex items-start gap-2.5 sm:gap-3 px-2.5 sm:px-4 py-0.5 hover:bg-white/[0.02] rounded-r-xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12 }}
      >
        <div className="w-9 shrink-0 flex items-center justify-center pt-0.5">
          <span className="text-[10px] text-neutral-600 tabular-nums opacity-0 group-hover:opacity-100 transition-opacity font-mono">
            {formatTimestamp(timestamp).slice(0, 5)}
          </span>
        </div>
        <div className={`${contentColumnClass} py-0.5`}>
          <div
            className={cn(
              bubbleBaseClass,
              isUser ? userBubbleClass : assistantBubbleClass,
              !showInternals && isSystemNote && "max-w-[120px] text-center",
            )}
          >
            <MarkdownContent content={displayContent || ""} streaming={streaming} />
            {images && images.length > 0 && <ImageGrid images={images} />}
          </div>
        </div>
      </motion.div>
    );
  }

  // Full message with avatar + header
  return (
    <motion.div
      className={cn(
        "group flex items-start gap-2.5 sm:gap-3 px-2.5 sm:px-4 pt-3 pb-1 hover:bg-white/[0.03] rounded-r-xl",
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <ChatAvatar
        name={displayName}
        isBot={isAssistant}
        imageUrl={isAssistant ? undefined : origin?.avatarUrl}
        accentColor={senderColor}
        size={36}
      />

      <div className={contentColumnClass}>
        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
          <span
            className={cn(
              "font-semibold text-sm leading-none",
              isUser ? "text-primary-200" : "text-neutral-100",
            )}
            style={isUser && senderColor ? { color: senderColor } : undefined}
          >
            {displayName}
          </span>

          {origin && <OriginBadge origin={origin} />}

          {showInternals && metadataLabel && (
            <span
              className="inline-flex items-center rounded-full border border-neutral-700/80 bg-neutral-900/75 px-1.5 py-0.5 text-[10px] leading-none text-neutral-500"
              title={metadataPrefixes?.join(" ")}
            >
              {metadataLabel}
            </span>
          )}

          {isOutbound && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-primary-200/85">
              <SendIcon size={8} />
              sending
            </span>
          )}

          <span className="text-[10px] text-neutral-600 tabular-nums leading-none ml-auto shrink-0 font-mono">
            {formatTimestamp(timestamp)}
          </span>
        </div>

        <div
          className={cn(
            bubbleBaseClass,
            isUser ? userBubbleClass : assistantBubbleClass,
            isOutbound &&
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_30px_rgba(14,165,233,0.22)]",
            !showInternals && isSystemNote && "max-w-[120px] text-center",
          )}
        >
          <MarkdownContent content={displayContent || ""} streaming={streaming} />
          {images && images.length > 0 && <ImageGrid images={images} />}
        </div>
      </div>
    </motion.div>
  );
}
