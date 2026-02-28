import { useGatewayRpc } from "../hooks/useGatewayRpc";
import type { SkillStatusEntry } from "../gateway/types";

export function Skills() {
  const { data, loading, error, refetch } = useGatewayRpc<{ skills: SkillStatusEntry[] }>("skills.status");

  const skills = data?.skills ?? [];
  const eligible = skills.filter((s) => s.eligible);
  const blocked = skills.filter((s) => s.blocked);

  return (
    <div>
      <div className="content-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div className="page-title">Skills</div>
          <div className="page-sub">{eligible.length} eligible · {blocked.length} blocked</div>
        </div>
        <button className="btn btn-ghost" onClick={refetch} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="callout danger" style={{ marginBottom: "12px" }}>{error}</div>}
      {loading && <div className="muted">Loading skills...</div>}

      {skills.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-head" style={{ gridTemplateColumns: "1fr 80px 80px 100px" }}>
            <span>Skill</span>
            <span>Source</span>
            <span>Status</span>
            <span>Missing</span>
          </div>
          {skills.map((skill) => (
            <div key={skill.skillId} className="table-row" style={{ gridTemplateColumns: "1fr 80px 80px 100px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>{skill.name ?? skill.skillId}</div>
                <div className="mono muted">{skill.skillId}</div>
              </div>
              <span className="muted">{skill.source ?? "\u2014"}</span>
              <span className={`pill ${skill.eligible ? "ok" : skill.blocked ? "danger" : "muted"}`}>
                {skill.eligible ? "eligible" : skill.blocked ? "blocked" : "disabled"}
              </span>
              <span className="muted" style={{ fontSize: "11px" }}>
                {skill.missingDeps && skill.missingDeps.length > 0 ? skill.missingDeps.join(", ") : "\u2014"}
              </span>
            </div>
          ))}
        </div>
      )}
      {!loading && skills.length === 0 && !error && (
        <div className="muted">Connect to gateway to view skills</div>
      )}
    </div>
  );
}
