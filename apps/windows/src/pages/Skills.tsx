import { useState, useMemo, useCallback } from 'react';
import { useGateway } from '../gateway/context';
import { usePollingRpc } from '../hooks/usePollingRpc';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { StatusPill } from '../components/common/StatusPill';
import { Spinner } from '../components/common/Spinner';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { AnimatedCounter } from '../components/common/AnimatedCounter';
import { cn } from '../lib/utils';
import { PageTransition } from '../components/motion/PageTransition';
import { StaggerContainer, StaggerItem } from '../components/motion/StaggerContainer';
import { FadeIn } from '../components/motion/FadeIn';
import type { SkillStatusEntry } from '../gateway/types';
import {
  Search,
  CheckCircle,
  Filter,
  RefreshCw,
  ShieldAlert,
  Puzzle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasMissingDeps(skill: SkillStatusEntry): boolean {
  if (!skill.missingDeps || !Array.isArray(skill.missingDeps)) {
    return false;
  }
  return skill.missingDeps.length > 0;
}

function getSkillStatus(skill: SkillStatusEntry): 'online' | 'offline' | 'warning' | 'error' {
  if (skill.enabled === false) {
    return 'offline';
  }
  if (skill.blocked) {
    return 'error';
  }
  if (hasMissingDeps(skill)) {
    return 'error';
  }
  if (skill.eligible) {
    return 'online';
  }
  return 'warning';
}

function getSkillStatusLabel(skill: SkillStatusEntry): string {
  if (skill.enabled === false) {
    return 'Disabled';
  }
  if (skill.blocked) {
    return 'Blocked';
  }
  if (hasMissingDeps(skill)) {
    return 'Missing Deps';
  }
  if (skill.eligible) {
    return 'Eligible';
  }
  return 'Ineligible';
}

function hasIssues(skill: SkillStatusEntry): boolean {
  return (
    skill.enabled === false ||
    skill.blocked === true ||
    hasMissingDeps(skill) ||
    !skill.eligible
  );
}

function getDepString(dep: string | { dep: string; installOptions?: string[] }): string {
  if (typeof dep === 'string') {
    return dep;
  }
  return dep.dep;
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

function SkillCard({
  skill,
  onToggle,
  toggling,
}: {
  skill: SkillStatusEntry;
  onToggle: (skillId: string, enabled: boolean) => void;
  toggling: boolean;
}) {
  const status = getSkillStatus(skill);
  const statusLabel = getSkillStatusLabel(skill);
  const reqs = skill.requirements;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg shrink-0" role="img" aria-label={skill.name ?? skill.skillId}>
            {skill.emoji ?? '\u2699\uFE0F'}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-neutral-100 truncate">
                {skill.name ?? skill.skillId}
              </h3>
              <Badge variant={skill.bundled ? 'info' : 'primary'}>
                {skill.bundled ? 'bundled' : 'custom'}
              </Badge>
            </div>
            {skill.description && (
              <p className="text-xs text-neutral-400 mt-0.5 line-clamp-2">
                {skill.description}
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <StatusPill status={status} label={statusLabel} />
          <Button
            variant="ghost"
            className="text-xs"
            loading={toggling}
            onClick={() => onToggle(skill.skillId, !(skill.enabled !== false))}
          >
            {skill.enabled !== false ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>

      {/* Requirements badges */}
      {reqs && (
        <div className="mt-3 flex flex-wrap gap-1">
          {reqs.bins?.map((bin) => {
            const missing = skill.missingDeps?.some((d) => getDepString(d) === bin);
            return (
              <Badge key={`bin-${bin}`} variant={missing ? 'error' : 'success'}>
                {bin}
              </Badge>
            );
          })}
          {reqs.env?.map((env) => {
            const missing = skill.missingDeps?.some((d) => getDepString(d) === env);
            return (
              <Badge key={`env-${env}`} variant={missing ? 'error' : 'success'}>
                ${env}
              </Badge>
            );
          })}
          {reqs.config?.map((cfg) => {
            return (
              <Badge key={`cfg-${cfg}`} variant="default">
                {cfg}
              </Badge>
            );
          })}
          {reqs.os?.map((os) => {
            const missing = skill.missingDeps?.some((d) => getDepString(d) === os);
            return (
              <Badge key={`os-${os}`} variant={missing ? 'error' : 'success'}>
                {os}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Missing deps section */}
      {hasMissingDeps(skill) && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-error-400">
            <AlertTriangle size={12} />
            <span>Missing Requirements</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skill.missingDeps!.map((dep, i) => {
              const depStr = getDepString(dep);
              const installOpts = typeof dep === 'object' ? dep.installOptions : undefined;
              return (
                <span key={`missing-${i}`} className="text-xs">
                  <Badge variant="error">{depStr}</Badge>
                  {installOpts && installOpts.length > 0 && (
                    <span className="ml-1 text-neutral-500">
                      ({installOpts.join(', ')})
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Blocked/disabled banners */}
      {skill.enabled === false && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-warning-500/5 border border-warning-500/10">
          <ShieldAlert size={14} className="text-warning-400 shrink-0" />
          <span className="text-xs text-warning-400">This skill is disabled.</span>
        </div>
      )}
      {skill.blocked && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-error-500/5 border border-error-500/10">
          <ShieldAlert size={14} className="text-error-400 shrink-0" />
          <span className="text-xs text-error-400">Blocked by skill allowlist.</span>
        </div>
      )}

      {/* Skill ID */}
      <div className="mt-3 text-[10px] text-neutral-600 font-mono truncate">
        {skill.skillId}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SummaryStats
// ---------------------------------------------------------------------------

function SummaryStats({ skills }: { skills: SkillStatusEntry[] }) {
  const total = skills.length;
  const eligible = skills.filter((s) => s.eligible && s.enabled !== false).length;
  const disabled = skills.filter((s) => s.enabled === false).length;
  const withMissing = skills.filter((s) => hasMissingDeps(s)).length;

  return (
    <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StaggerItem>
        <StatCard icon={Puzzle} label="Total" value={total} />
      </StaggerItem>
      <StaggerItem>
        <StatCard icon={CheckCircle} label="Eligible" value={eligible} color="text-success-400" />
      </StaggerItem>
      <StaggerItem>
        <StatCard icon={ShieldAlert} label="Disabled" value={disabled} color="text-warning-400" />
      </StaggerItem>
      <StaggerItem>
        <StatCard icon={AlertTriangle} label="Missing Deps" value={withMissing} color="text-error-400" />
      </StaggerItem>
    </StaggerContainer>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-semibold text-neutral-100 mt-1">
            <AnimatedCounter value={value} />
          </p>
        </div>
        <div
          className={cn(
            'p-2 rounded-lg',
            color
              ? 'bg-gradient-to-br from-neutral-700/30 to-neutral-800/50'
              : 'bg-gradient-to-br from-primary-500/15 to-primary-500/5',
          )}
        >
          <Icon size={18} className={color ?? 'text-primary-400'} />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skills — main page
// ---------------------------------------------------------------------------

export function Skills() {
  const { rpc } = useGateway();
  const { data, loading, error, refresh } = usePollingRpc<{ skills: SkillStatusEntry[] }>(
    'skills.status',
    undefined,
    60_000,
  );
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);

  const skills = useMemo(() => data?.skills ?? [], [data]);

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return skills.filter((skill) => {
      if (lowerSearch) {
        const matchesName = (skill.name ?? skill.skillId).toLowerCase().includes(lowerSearch);
        const matchesDesc = (skill.description ?? '').toLowerCase().includes(lowerSearch);
        if (!matchesName && !matchesDesc) {
          return false;
        }
      }
      if (issuesOnly && !hasIssues(skill)) {
        return false;
      }
      return true;
    });
  }, [skills, search, issuesOnly]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleToggle = useCallback(
    async (skillId: string, enabled: boolean) => {
      setTogglingSkillId(skillId);
      try {
        await rpc('skills.update', { skillId, enabled });
        refresh();
      } finally {
        setTogglingSkillId(null);
      }
    },
    [rpc, refresh],
  );

  // Loading
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={32} />
      </div>
    );
  }

  // Error
  if (error && !data) {
    return (
      <PageTransition>
        <FadeIn>
          <div className="space-y-6">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Skills</h1>
              <p className="text-sm text-neutral-400 mt-1">Manage and monitor installed skills.</p>
            </div>
            <Card>
              <div className="flex items-center gap-3 text-error-400">
                <XCircle size={20} />
                <div>
                  <p className="text-sm font-medium">Failed to load skills</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{error}</p>
                </div>
              </div>
              <div className="mt-3">
                <Button variant="secondary" onClick={handleRefresh}>
                  <RefreshCw size={14} />
                  Retry
                </Button>
              </div>
            </Card>
          </div>
        </FadeIn>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Header */}
        <FadeIn>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Skills</h1>
              <p className="text-sm text-neutral-400 mt-1">
                Manage and monitor installed skills.
              </p>
            </div>
            <Button
              variant="secondary"
              loading={refreshing}
              onClick={handleRefresh}
              className="shrink-0"
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </FadeIn>

        {/* Summary stats */}
        {skills.length > 0 && <SummaryStats skills={skills} />}

        {/* Search & filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              placeholder="Filter skills by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-neutral-900/50 border border-neutral-700/50 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>
          <Button
            variant={issuesOnly ? 'primary' : 'secondary'}
            onClick={() => setIssuesOnly((prev) => !prev)}
          >
            <Filter size={14} />
            {issuesOnly ? 'Issues Only' : 'All Skills'}
          </Button>
        </div>

        {/* Skill list */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={Puzzle}
            title={skills.length === 0 ? 'No skills found' : 'No matching skills'}
            description={
              skills.length === 0
                ? 'No skills are installed.'
                : 'Try adjusting your search or filter criteria.'
            }
          />
        ) : (
          <StaggerContainer className="space-y-3">
            <div className="text-xs text-neutral-500">
              Showing {filtered.length} of {skills.length} skill
              {skills.length !== 1 ? 's' : ''}
            </div>
            {filtered.map((skill) => (
              <StaggerItem key={skill.skillId}>
                <SkillCard
                  skill={skill}
                  onToggle={handleToggle}
                  toggling={togglingSkillId === skill.skillId}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </PageTransition>
  );
}
