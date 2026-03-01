import { useMemo } from "react";
import { usePollingRpc } from "../hooks/usePollingRpc";
import type { ChannelsStatusSnapshot, ChannelAccountSnapshot } from "../gateway/types";
import { Card } from "../components/common/Card";
import { Badge } from "../components/common/Badge";
import { StatusPill } from "../components/common/StatusPill";
import { Spinner } from "../components/common/Spinner";
import { EmptyState } from "../components/common/EmptyState";
import { AnimatedCounter } from "../components/common/AnimatedCounter";
import { PageTransition } from "../components/motion/PageTransition";
import { FadeIn } from "../components/motion/FadeIn";
import { StaggerContainer, StaggerItem } from "../components/motion/StaggerContainer";
import { cn, formatRelativeTime } from "../lib/utils";
import {
  Hash,
  Send,
  Phone,
  Shield,
  MessageSquare,
  MessageCircle,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Wifi,
  Link2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Channel icon + gradient helpers
// ---------------------------------------------------------------------------

function renderChannelIcon(channelId: string, props: { size: number; className?: string }) {
  const id = channelId.toLowerCase();
  if (id === "discord") { return <Hash size={props.size} className={props.className} />; }
  if (id === "telegram") { return <Send size={props.size} className={props.className} />; }
  if (id === "whatsapp") { return <Phone size={props.size} className={props.className} />; }
  if (id === "slack") { return <Hash size={props.size} className={props.className} />; }
  if (id === "signal") { return <Shield size={props.size} className={props.className} />; }
  if (id === "sms") { return <MessageSquare size={props.size} className={props.className} />; }
  if (id === "imessage") { return <MessageCircle size={props.size} className={props.className} />; }
  return <Link2 size={props.size} className={props.className} />;
}

const CHANNEL_ICON_BG: Record<string, string> = {
  discord: "from-indigo-500/15 to-indigo-500/5",
  telegram: "from-sky-500/15 to-sky-500/5",
  whatsapp: "from-emerald-500/15 to-emerald-500/5",
  slack: "from-purple-500/15 to-purple-500/5",
  signal: "from-blue-500/15 to-blue-500/5",
  sms: "from-orange-500/15 to-orange-500/5",
  imessage: "from-green-500/15 to-green-500/5",
};

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

type AccountStatus = "online" | "warning" | "offline" | "error";

function deriveAccountStatus(account: ChannelAccountSnapshot): AccountStatus {
  if (account.lastError || account.error) { return "error"; }
  if (account.connected) { return "online"; }
  if (account.running) { return "warning"; }
  return "offline";
}

function statusLabel(status: AccountStatus): string {
  switch (status) {
    case "online": return "Connected";
    case "warning": return "Connecting";
    case "error": return "Error";
    case "offline": return "Offline";
  }
}

function dmPolicyVariant(policy: string | null | undefined): "success" | "warning" | "info" | "default" {
  if (!policy) { return "default"; }
  switch (policy) {
    case "open": return "success";
    case "restricted": return "warning";
    case "closed": return "warning";
    default: return "info";
  }
}

// ---------------------------------------------------------------------------
// AccountRow
// ---------------------------------------------------------------------------

function AccountRow({ account }: { account: ChannelAccountSnapshot }) {
  const status = deriveAccountStatus(account);

  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-neutral-800/60 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusPill status={status} label={statusLabel(status)} />
          <span className="text-sm font-medium text-neutral-200 truncate">
            {account.accountId ?? "Account"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {account.mode && <Badge variant="info">{account.mode}</Badge>}
          {account.dmPolicy && (
            <Badge variant={dmPolicyVariant(account.dmPolicy)}>
              DM: {account.dmPolicy}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-neutral-500">
        {account.lastConnectedAt != null && (
          <span className="flex items-center gap-1">
            <Wifi size={11} />
            {formatRelativeTime(account.lastConnectedAt)}
          </span>
        )}
        {account.reconnectAttempts != null && account.reconnectAttempts > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangle size={11} className="text-warning-400" />
            {account.reconnectAttempts} reconnect{account.reconnectAttempts === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {(account.lastError || account.error) && (
        <p className="text-xs text-error-400 bg-error-500/5 rounded px-2 py-1 font-mono break-all truncate">
          {account.lastError ?? account.error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelCard
// ---------------------------------------------------------------------------

function ChannelCard({
  channelId,
  label,
  accounts,
}: {
  channelId: string;
  label: string;
  accounts: ChannelAccountSnapshot[];
}) {
  const connectedCount = accounts.filter((a) => a.connected).length;
  const errorCount = accounts.filter((a) => a.lastError || a.error).length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("p-2 rounded-lg bg-gradient-to-br", CHANNEL_ICON_BG[channelId.toLowerCase()] ?? "from-primary-500/15 to-primary-500/5")}>
            {renderChannelIcon(channelId, { size: 18, className: "text-primary-400" })}
          </div>
          <h3 className="text-sm font-semibold text-neutral-100">{label}</h3>
        </div>
        <div className="flex items-center gap-2">
          {connectedCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-success-400">
              <CheckCircle2 size={12} />
              {connectedCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-error-400">
              <AlertTriangle size={12} />
              {errorCount}
            </span>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No accounts configured.</p>
      ) : (
        <div className="divide-y divide-neutral-800/40">
          {accounts.map((account, i) => (
            <AccountRow key={account.accountId ?? i} account={account} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary Bar
// ---------------------------------------------------------------------------

function SummaryBar({
  totalChannels,
  activeAccounts,
  errorCount,
}: {
  totalChannels: number;
  activeAccounts: number;
  errorCount: number;
}) {
  return (
    <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StaggerItem>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-500/10">
              <Radio size={18} className="text-primary-400" />
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Channels</p>
              <p className="text-xl font-semibold text-neutral-100"><AnimatedCounter value={totalChannels} /></p>
            </div>
          </div>
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-500/10">
              <CheckCircle2 size={18} className="text-success-400" />
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Active Accounts</p>
              <p className="text-xl font-semibold text-neutral-100"><AnimatedCounter value={activeAccounts} /></p>
            </div>
          </div>
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Card>
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", errorCount > 0 ? "bg-error-500/10" : "bg-neutral-800")}>
              <AlertTriangle
                size={18}
                className={errorCount > 0 ? "text-error-400" : "text-neutral-500"}
              />
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Errors</p>
              <p className={cn("text-xl font-semibold", errorCount > 0 ? "text-error-400" : "text-neutral-100")}>
                <AnimatedCounter value={errorCount} />
              </p>
            </div>
          </div>
        </Card>
      </StaggerItem>
    </StaggerContainer>
  );
}

// ---------------------------------------------------------------------------
// Channels (main export)
// ---------------------------------------------------------------------------

export function Channels() {
  const { data, loading, error } = usePollingRpc<ChannelsStatusSnapshot>(
    "channels.status",
    undefined,
    15_000,
  );

  const stats = useMemo(() => {
    if (!data?.channels) { return { totalChannels: 0, activeAccounts: 0, errorCount: 0 }; }

    const allAccounts = data.channels.flatMap((ch) => ch.accounts ?? []);
    return {
      totalChannels: data.channels.length,
      activeAccounts: allAccounts.filter((a) => a.connected).length,
      errorCount: allAccounts.filter((a) => a.lastError || a.error).length,
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load channels"
        description={error}
      />
    );
  }

  if (!data?.channels || data.channels.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="No channels configured"
        description="Configure messaging channels in your gateway settings to see them here."
      />
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">Channels</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Messaging platform integrations and connection status.
            </p>
          </div>
        </FadeIn>

        <SummaryBar
          totalChannels={stats.totalChannels}
          activeAccounts={stats.activeAccounts}
          errorCount={stats.errorCount}
        />

        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.channels.map((ch) => {
            const label = data.channelLabels?.[ch.channelId] ?? ch.channelId;
            const accounts = ch.accounts ?? data.channelAccounts?.[ch.channelId] ?? [];

            return (
              <StaggerItem key={ch.channelId}>
                <ChannelCard
                  channelId={ch.channelId}
                  label={label}
                  accounts={accounts}
                />
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </div>
    </PageTransition>
  );
}
