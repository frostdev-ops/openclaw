import { usePresenceStore } from '../stores/connection';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { StatusPill } from '../components/common/StatusPill';
import { EmptyState } from '../components/common/EmptyState';
import { AnimatedCounter } from '../components/common/AnimatedCounter';
import { PageTransition } from '../components/motion/PageTransition';
import { StaggerContainer, StaggerItem } from '../components/motion/StaggerContainer';
import { FadeIn } from '../components/motion/FadeIn';
import { formatRelativeTime } from '../lib/utils';
import type { PresenceEntry } from '../gateway/types';
import { Monitor, Wifi, Users } from 'lucide-react';

// ---------------------------------------------------------------------------
// Instances — main page
// ---------------------------------------------------------------------------

export function Instances() {
  const presence: PresenceEntry[] = usePresenceStore((s) => s.entries);

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Header */}
        <FadeIn>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Instances</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Connected gateway instances and their status.
            </p>
          </div>
        </FadeIn>

        {/* Stat card */}
        <FadeIn delay={0.1}>
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Connected Instances</p>
                <p className="text-2xl font-semibold text-neutral-100 mt-1">
                  <AnimatedCounter value={presence.length} />
                </p>
              </div>
              <div className="p-2 rounded-lg bg-gradient-to-br from-success-500/15 to-success-500/5">
                <Users size={20} className="text-success-400" />
              </div>
            </div>
          </Card>
        </FadeIn>

        {/* Presence entries */}
        {presence.length === 0 ? (
          <EmptyState
            icon={Monitor}
            title="No instances connected"
            description="No gateway instances are currently online."
          />
        ) : (
          <StaggerContainer className="space-y-3">
            {presence.map((entry, i) => (
              <StaggerItem key={entry.key ?? i}>
                <Card>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center">
                        <Monitor size={18} className="text-primary-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusPill status="online" />
                          <span className="text-sm font-medium text-neutral-200 truncate">
                            {entry.displayName ?? entry.clientId ?? 'Unknown'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {entry.roles?.map((role) => (
                            <Badge key={role} variant="info">{role}</Badge>
                          ))}
                          {entry.mode && (
                            <Badge variant="default">{entry.mode}</Badge>
                          )}
                          {entry.platform && (
                            <span className="text-xs text-neutral-500">{entry.platform}</span>
                          )}
                          {entry.version && (
                            <span className="text-xs text-neutral-500">v{entry.version}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-3">
                      {entry.connectedAtMs && (
                        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                          <Wifi size={12} />
                          <span>{formatRelativeTime(entry.connectedAtMs)}</span>
                        </div>
                      )}
                      {entry.connId && (
                        <span className="text-[11px] text-neutral-600 font-mono block mt-1">
                          {entry.connId.slice(0, 12)}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </PageTransition>
  );
}
