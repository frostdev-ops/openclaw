import { useState, useCallback, useEffect } from 'react';
import { useGateway } from '../gateway/context';
import { usePollingRpc } from '../hooks/usePollingRpc';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { StatusPill } from '../components/common/StatusPill';
import { Spinner } from '../components/common/Spinner';
import { EmptyState } from '../components/common/EmptyState';
import { Button } from '../components/common/Button';
import { cn, formatRelativeTime, formatDuration } from '../lib/utils';
import { PageTransition } from '../components/motion/PageTransition';
import { StaggerContainer, StaggerItem } from '../components/motion/StaggerContainer';
import { FadeIn } from '../components/motion/FadeIn';
import { AnimatePresence, motion } from 'motion/react';
import type { CronJob, CronScheduleInterval, CronStatus, CronRunLogEntry } from '../gateway/types';
import {
  Clock,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Zap,
  CalendarClock,
  History,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSchedule(schedule?: string | CronScheduleInterval): string {
  if (!schedule) {return '';}
  if (typeof schedule === 'string') {return schedule;}
  if (schedule.everyMs) {
    return `every ${formatDuration(schedule.everyMs)}`;
  }
  return schedule.kind ?? JSON.stringify(schedule);
}

function formatNextRun(ms?: number, nowMs?: number): string {
  if (!ms) {
    return '—';
  }
  const now = nowMs ?? Date.now();
  if (ms <= now) {
    return formatRelativeTime(ms);
  }
  const diff = ms - now;
  if (diff < 60_000) {
    return `in ${Math.round(diff / 1000)}s`;
  }
  if (diff < 3_600_000) {
    return `in ${Math.round(diff / 60_000)}m`;
  }
  return `in ${Math.round(diff / 3_600_000)}h`;
}

function statusBadgeVariant(status?: string) {
  if (status === 'ok' || status === 'pass') {
    return 'success' as const;
  }
  if (status === 'error' || status === 'fail') {
    return 'error' as const;
  }
  return 'warning' as const;
}

// ---------------------------------------------------------------------------
// CronJobCard
// ---------------------------------------------------------------------------

function CronJobCard({
  job,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onRun,
  onDelete,
  togglingId,
  runningId,
  deletingId,
  nowMs,
}: {
  job: CronJob;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onToggleEnabled: (job: CronJob) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  togglingId: string | null;
  runningId: string | null;
  deletingId: string | null;
  nowMs: number;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className={cn(!job.enabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        {/* Expand toggle */}
        <button
          className="mt-0.5 p-0.5 rounded hover:bg-neutral-800 text-neutral-500 transition-colors"
          onClick={() => onToggleExpand(job.id)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="text-sm font-semibold text-neutral-100 truncate cursor-pointer hover:text-primary-400 transition-colors"
              onClick={() => onToggleExpand(job.id)}
            >
              {job.name ?? job.id}
            </h3>
            <Badge variant={job.enabled ? 'success' : 'default'}>
              {job.enabled ? 'enabled' : 'disabled'}
            </Badge>
            {job.lastStatus && (
              <Badge variant={statusBadgeVariant(job.lastStatus)}>
                {job.lastStatus}
              </Badge>
            )}
          </div>

          {job.command && (
            <p className="text-xs text-neutral-400 mt-1 font-mono truncate">
              {job.command}
            </p>
          )}

          <div className="flex items-center gap-4 mt-2 flex-wrap text-xs text-neutral-500">
            {job.schedule && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={12} className="text-warning-400" />
                <code className="bg-neutral-800 rounded px-1.5 py-0.5 font-mono">
                  {formatSchedule(job.schedule)}
                </code>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock size={12} className="text-primary-400" />
              Next: {formatNextRun(job.nextRunAtMs, nowMs)}
            </span>
            {job.lastRunAtMs && (
              <span>Last: {formatRelativeTime(job.lastRunAtMs)}</span>
            )}
          </div>
        </div>

        {/* Enable/disable toggle */}
        <button
          className={cn(
            'p-1 rounded transition-colors',
            togglingId === job.id
              ? 'opacity-50 pointer-events-none'
              : 'hover:bg-neutral-800',
          )}
          onClick={() => onToggleEnabled(job)}
          title={job.enabled ? 'Disable job' : 'Enable job'}
          disabled={togglingId === job.id}
        >
          {job.enabled ? (
            <ToggleRight size={24} className="text-success-400" />
          ) : (
            <ToggleLeft size={24} className="text-neutral-600" />
          )}
        </button>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-neutral-800 space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  loading={runningId === job.id}
                  onClick={() => onRun(job.id)}
                >
                  <Play size={14} />
                  Run Now
                </Button>

                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-error-400">Delete?</span>
                    <Button
                      variant="danger"
                      loading={deletingId === job.id}
                      onClick={() => {
                        onDelete(job.id);
                        setConfirmDelete(false);
                      }}
                    >
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-error-400 hover:text-error-300"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RunLogSection
// ---------------------------------------------------------------------------

function RunLogSection({
  entries,
  loading,
  error,
}: {
  entries: CronRunLogEntry[];
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <History size={16} className="text-primary-400" />
          Run History
          {entries.length > 0 && (
            <Badge variant="default">{entries.length}</Badge>
          )}
        </h2>
        {open ? (
          <ChevronDown size={16} className="text-neutral-500" />
        ) : (
          <ChevronRight size={16} className="text-neutral-500" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="overflow-hidden"
          >
            <div className="mt-4">
              {loading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : error ? (
                <div className="text-sm text-error-400 py-4">{error}</div>
              ) : entries.length === 0 ? (
                <p className="text-sm text-neutral-500 py-4">No run history yet.</p>
              ) : (
                <StaggerContainer className="space-y-2 max-h-96 overflow-auto">
                  {entries.map((entry, i) => (
                    <StaggerItem key={`${entry.ts}-${entry.jobId}-${i}`}>
                      <div
                        className={cn(
                          'flex items-start gap-3 rounded-md p-2 text-sm',
                          entry.status === 'ok' && 'bg-success-500/5',
                          entry.status === 'error' && 'bg-error-500/5',
                        )}
                      >
                        {entry.status === 'ok' ? (
                          <CheckCircle size={14} className="text-success-400 mt-0.5" />
                        ) : (
                          <AlertCircle size={14} className="text-error-400 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-neutral-200 font-medium">
                              {entry.jobName ?? entry.jobId}
                            </span>
                            <Badge variant={statusBadgeVariant(entry.status)}>
                              {entry.status}
                            </Badge>
                            {entry.durationMs != null && (
                              <span className="text-xs text-neutral-500">
                                {formatDuration(entry.durationMs)}
                              </span>
                            )}
                          </div>
                          {entry.error && (
                            <p className="text-xs text-error-400 mt-0.5 line-clamp-2">
                              {entry.error}
                            </p>
                          )}
                          <span className="text-xs text-neutral-600 mt-1 block">
                            {new Date(entry.ts).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cron — main page
// ---------------------------------------------------------------------------

export function Cron() {
  const { rpc } = useGateway();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Polling RPCs
  const {
    data: cronStatus,
    loading: statusLoading,
  } = usePollingRpc<CronStatus>('cron.status', undefined, 30_000);

  const {
    data: jobsData,
    loading: jobsLoading,
    error: jobsError,
    refresh: refreshJobs,
  } = usePollingRpc<{ jobs: CronJob[] }>('cron.list', undefined, 30_000);

  // Run log — fetched on demand
  const [logEntries, setLogEntries] = useState<CronRunLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const jobs = jobsData?.jobs ?? [];

  // Tick the clock for relative times
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Fetch run logs when a job is expanded
  useEffect(() => {
    if (!expandedId) {
      return;
    }
    setLogLoading(true);
    setLogError(null);
    void rpc<{ entries: CronRunLogEntry[] }>('cron.runs', { id: expandedId, limit: 200 }).then((res) => {
      if (res.ok && res.payload) {
        setLogEntries(res.payload.entries ?? []);
      } else if (res.error) {
        setLogError(res.error.message);
      }
      setLogLoading(false);
    });
  }, [expandedId, rpc]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleToggleEnabled = useCallback(
    async (job: CronJob) => {
      setTogglingId(job.id);
      try {
        await rpc('cron.update', { id: job.id, enabled: !job.enabled });
        refreshJobs();
      } finally {
        setTogglingId(null);
      }
    },
    [rpc, refreshJobs],
  );

  const handleRun = useCallback(
    async (id: string) => {
      setRunningId(id);
      try {
        await rpc('cron.run', { id });
        refreshJobs();
      } finally {
        setRunningId(null);
      }
    },
    [rpc, refreshJobs],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await rpc('cron.remove', { id });
        setExpandedId(null);
        refreshJobs();
      } finally {
        setDeletingId(null);
      }
    },
    [rpc, refreshJobs],
  );

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Header */}
        <FadeIn>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Cron Jobs</h1>
              <p className="text-sm text-neutral-400 mt-1">
                Scheduled tasks, triggers, and run history.
              </p>
            </div>
            <Button variant="secondary" onClick={refreshJobs} loading={jobsLoading}>
              Refresh
            </Button>
          </div>
        </FadeIn>

        {/* Scheduler status bar */}
        <Card>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Zap size={16} className="text-primary-400" />
                Scheduler Status
              </h2>
              {statusLoading ? (
                <Spinner size={14} />
              ) : cronStatus ? (
                <div className="flex items-center gap-3">
                  <StatusPill
                    status={cronStatus.enabled ? 'online' : 'offline'}
                    label={cronStatus.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <span className="text-xs text-neutral-500">
                    {cronStatus.jobs} job{cronStatus.jobs !== 1 ? 's' : ''}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-neutral-500">Unavailable</span>
              )}
            </div>

            {cronStatus?.nextWakeAtMs != null && (
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Clock size={14} className="text-primary-400" />
                <span>
                  Next wake:{' '}
                  {cronStatus.nextWakeAtMs > nowMs
                    ? new Date(cronStatus.nextWakeAtMs).toLocaleTimeString()
                    : formatRelativeTime(cronStatus.nextWakeAtMs)}
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Job list */}
        {jobsLoading && jobs.length === 0 ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : jobsError ? (
          <Card>
            <div className="flex items-center gap-2 text-error-400 text-sm">
              <AlertCircle size={16} />
              <span>Failed to load cron jobs: {jobsError}</span>
            </div>
            <Button className="mt-3" onClick={refreshJobs}>
              Retry
            </Button>
          </Card>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No cron jobs"
            description="No scheduled jobs have been configured yet."
          />
        ) : (
          <StaggerContainer className="space-y-3">
            {jobs.map((job) => (
              <StaggerItem key={job.id}>
                <CronJobCard
                  job={job}
                  expanded={expandedId === job.id}
                  onToggleExpand={handleToggleExpand}
                  onToggleEnabled={handleToggleEnabled}
                  onRun={handleRun}
                  onDelete={handleDelete}
                  togglingId={togglingId}
                  runningId={runningId}
                  deletingId={deletingId}
                  nowMs={nowMs}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}

        {/* Run history */}
        <RunLogSection
          entries={logEntries}
          loading={logLoading}
          error={logError}
        />
      </div>
    </PageTransition>
  );
}
