import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { CronJob } from "../gateway/types";

function formatSchedule(s?: string): string {
  return s ?? "—";
}

function formatNextRun(ms?: number): string {
  if (!ms) { return "—"; }
  const diff = ms - Date.now();
  if (diff < 0) { return "overdue"; }
  if (diff < 60000) { return `in ${Math.round(diff / 1000)}s`; }
  if (diff < 3600000) { return `in ${Math.round(diff / 60000)}m`; }
  return `in ${Math.round(diff / 3600000)}h`;
}

export function Cron() {
  const { data: cronData, loading, error, refetch } = useGatewayRpc<{ jobs: CronJob[] }>("cron.list");
  const { data: statusData } = useGatewayRpc<{ enabled?: boolean; runningJobs?: number }>("cron.status");

  const jobs = cronData?.jobs ?? [];

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Cron Jobs</div>
          <div className="page-sub" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {jobs.length} job{jobs.length !== 1 ? "s" : ""}
            {statusData?.enabled && <span className="pill ok">Active</span>}
            {statusData?.enabled === false && <span className="pill muted">Disabled</span>}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}
      {loading && <div className="muted">Loading cron jobs...</div>}

      {!loading && jobs.length === 0 && !error && (
        <div className="callout">No cron jobs configured</div>
      )}

      {jobs.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-head" style={{ gridTemplateColumns: "1fr 140px 80px 100px 80px" }}>
            <span>Job</span>
            <span>Schedule</span>
            <span>Next Run</span>
            <span>Last Status</span>
            <span>Enabled</span>
          </div>
          {jobs.map((job) => (
            <div key={job.id} className="table-row" style={{ gridTemplateColumns: "1fr 140px 80px 100px 80px" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{job.name ?? job.id}</div>
                {job.command && <div className="mono muted">{job.command.slice(0, 40)}</div>}
              </div>
              <span className="mono muted">{formatSchedule(job.schedule)}</span>
              <span className="muted">{formatNextRun(job.nextRunAtMs)}</span>
              <span className={`pill ${job.lastStatus === "ok" || job.lastStatus === "pass" ? "ok" : job.lastStatus ? "danger" : "muted"}`}>
                {job.lastStatus ?? "never"}
              </span>
              <span className={`pill ${job.enabled ? "ok" : "muted"}`}>
                {job.enabled ? "yes" : "no"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
