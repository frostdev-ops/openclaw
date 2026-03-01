import type { LucideIcon } from "lucide-react";
import {
  MessageCircle,
  Hash,
  Send,
  Phone,
  Radio,
  Globe,
  MessagesSquare,
  AtSign,
  Building2,
  Smartphone,
  Zap,
} from "lucide-react";

export type ProviderMeta = {
  icon: LucideIcon;
  label: string;
  color: string;
  badgeVariant: "default" | "info" | "primary" | "success" | "warning" | "error";
};

const PROVIDERS: Record<string, ProviderMeta> = {
  discord: { icon: Hash, label: "Discord", color: "text-indigo-400", badgeVariant: "primary" },
  telegram: { icon: Send, label: "Telegram", color: "text-sky-400", badgeVariant: "info" },
  slack: { icon: MessagesSquare, label: "Slack", color: "text-purple-400", badgeVariant: "primary" },
  whatsapp: { icon: Phone, label: "WhatsApp", color: "text-green-400", badgeVariant: "success" },
  signal: { icon: Radio, label: "Signal", color: "text-blue-400", badgeVariant: "info" },
  imessage: { icon: Smartphone, label: "iMessage", color: "text-sky-300", badgeVariant: "info" },
  nostr: { icon: Globe, label: "Nostr", color: "text-violet-400", badgeVariant: "primary" },
  googlechat: { icon: MessageCircle, label: "Google Chat", color: "text-emerald-400", badgeVariant: "success" },
  webchat: { icon: MessageCircle, label: "Web Chat", color: "text-cyan-300", badgeVariant: "info" },
  msteams: { icon: Building2, label: "MS Teams", color: "text-blue-500", badgeVariant: "info" },
  email: { icon: AtSign, label: "Email", color: "text-amber-400", badgeVariant: "warning" },
  "auto-router": { icon: Zap, label: "Auto-Router", color: "text-amber-400", badgeVariant: "warning" },
};

const FALLBACK: ProviderMeta = {
  icon: MessageCircle,
  label: "Unknown",
  color: "text-neutral-400",
  badgeVariant: "default",
};

export function getProviderMeta(provider: string | undefined | null): ProviderMeta {
  if (!provider) {
    return FALLBACK;
  }
  return PROVIDERS[provider.toLowerCase()] ?? FALLBACK;
}
