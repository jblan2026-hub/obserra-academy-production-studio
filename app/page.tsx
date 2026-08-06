import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getStudioStatusSnapshot } from "@/lib/repositories/studio-repository";
import { getMissionControlOperations } from "@/lib/repositories/mission-control-repository";

export const dynamic = "force-dynamic";

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function formatUpdated(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function statusClass(status: string): string {
  const normalized = status.toUpperCase();
  return normalized === "SUCCEEDED" || normalized === "PUBLISHED" || normalized === "APPROVED" || normalized === "SUCCESS"
    ? "healthy"
    : normalized === "FAILED" || normalized === "DENIED" || normalized === "ROLLED_BACK"
      ? "review"
      : "muted-status";
}

export default async function StudioDashboard() {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/select-organization");

  const [snapshot, operations] = await Promise.all([
    getStudioStatusSnapshot(orgId),
    getMissionControlOperations(orgId),
  ]);
  const { metrics, queues, expertPanel, sourceIntelligence } = snapshot;

  return (
    <main className="studio-shell">
      <aside className="studio-nav">
        <div className="brand-block"><span>OBSERRA</span><strong>ACADEMY STUDIO</strong><small>Enterprise LCMS</small></div>
        <div className="identity-block">
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
          <div><UserButton /><small>{orgRole ?? "organization member"}</small></div>
        </div>
        <nav aria-label="Studio navigation">
          {["Mission Control", "Production Queue", "Expert Panel", "Source Intelligence", "Build History", "Release History", "Activity Timeline", "Course Authoring", "Visual Production", "Video Production", "Quality Gates", "Review and Approval", "Publishing Center", "Analytics", "Administration"].map((item, index) => (
            <a key={item} className={index === 0 ? "active" : ""} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>{item}</a>
          ))}
        </nav>
        <div className="nav-status"><span className="status-dot" />Organization scoped session active</div>
      </aside>

      <section className="studio-main">
        <header className="studio-header">
          <div>
            <p className="eyebrow">EXECUTIVE MISSION CONTROL</p>
            <h1>Academy production, governance, and publishing intelligence.</h1>
            <p>One governed workspace for course authoring, expert review, media production, compliance validation, packaging, publication, licensing, certificates, and analytics.</p>
            <small>Operational sources: portfolio {snapshot.source}; history {operations.source}</small>
          </div>
          <div className="header-actions"><button>Collect sources</button><button className="primary">Create course</button></div>
        </header>

        <section className="metrics-grid">
          <MetricCard label="ACTIVE COURSES" value={metrics.activeCourses} detail="Across the production lifecycle" />
          <MetricCard label="AVERAGE QUALITY" value={`${metrics.averageQuality}%`} detail="Current weighted quality score" />
          <MetricCard label="REVIEW QUEUE" value={metrics.reviewQueue} detail="Awaiting expert or executive action" />
          <MetricCard label="EXPERT AGENTS" value={metrics.expertAgents} detail="Structured domain contributors" />
          <MetricCard label="SOURCE SYSTEMS" value={metrics.sourceSystems} detail="Authoritative collections monitored" />
          <MetricCard label="RELEASE READINESS" value={`${metrics.releaseReadiness}%`} detail="Portfolio production readiness" />
        </section>

        <section className="panel" id="production-queue">
          <div className="panel-heading"><div><p className="eyebrow">PRODUCTION QUEUE</p><h2>Course lifecycle command view</h2></div><span>{queues.total} courses</span></div>
          <div className="queue-table">
            <div className="queue-row queue-head"><span>Course</span><span>Stage</span><span>Quality</span><span>Lead expert</span><span>Updated</span></div>
            {queues.items.map((course) => <div className="queue-row" key={course.id}><strong>{course.title}</strong><span><b className={`stage stage-${course.status.toLowerCase()}`}>{course.status}</b></span><span>{course.quality}%</span><span>{course.owner}</span><span>{formatUpdated(course.updated)}</span></div>)}
          </div>
        </section>

        <div className="two-column">
          <section className="panel" id="expert-panel">
            <div className="panel-heading"><div><p className="eyebrow">AI EXPERT PANEL</p><h2>Structured contributors</h2></div><span>{expertPanel.active} active</span></div>
            <div className="expert-grid">{expertPanel.members.map((expert) => <span key={expert}>{expert}</span>)}</div>
          </section>
          <section className="panel" id="source-intelligence">
            <div className="panel-heading"><div><p className="eyebrow">SOURCE INTELLIGENCE</p><h2>Authoritative collection status</h2></div><span>{sourceIntelligence.systemsRequiringReview} require review</span></div>
            <div className="source-list">{sourceIntelligence.systems.map((source) => <article key={`${source.name}-${source.lastCollection}`}><div><strong>{source.name}</strong><small>Collected {formatUpdated(source.lastCollection)}</small></div><div><span className={source.status.toUpperCase() === "HEALTHY" ? "healthy" : "review"}>{source.status}</span><small>{source.impactedCourses} impacted courses</small></div></article>)}</div>
          </section>
        </div>

        <div className="operations-grid">
          <section className="panel" id="build-history">
            <div className="panel-heading"><div><p className="eyebrow">BUILD HISTORY</p><h2>Recent production builds</h2></div><span>{operations.builds.length} shown</span></div>
            <div className="operation-list">
              {operations.builds.map((build) => <article key={build.id}><div><strong>{build.course}</strong><small>{build.type}</small></div><div><span className={statusClass(build.status)}>{build.status}</span><small>{formatUpdated(build.createdAt)}</small></div></article>)}
            </div>
          </section>

          <section className="panel" id="release-history">
            <div className="panel-heading"><div><p className="eyebrow">RELEASE HISTORY</p><h2>Governed release activity</h2></div><span>{operations.releases.length} shown</span></div>
            <div className="operation-list">
              {operations.releases.map((release) => <article key={release.id}><div><strong>{release.course}</strong><small>Version {release.version}</small></div><div><span className={statusClass(release.status)}>{release.status}</span><small>{formatUpdated(release.createdAt)}</small></div></article>)}
            </div>
          </section>

          <section className="panel" id="activity-timeline">
            <div className="panel-heading"><div><p className="eyebrow">ACTIVITY TIMELINE</p><h2>Immutable operational events</h2></div><span>{operations.activity.length} shown</span></div>
            <div className="operation-list">
              {operations.activity.map((event) => <article key={event.id}><div><strong>{event.action}</strong><small>{event.resource} by {event.actor}</small></div><div><span className={statusClass(event.outcome)}>{event.outcome}</span><small>{formatUpdated(event.createdAt)}</small></div></article>)}
            </div>
          </section>
        </div>

        <section className="panel release-panel">
          <div><p className="eyebrow">CONTROLLED PUBLISHING</p><h2>One approved action, governed downstream execution.</h2><p>Approved releases synchronize Academy delivery, website catalog, marketplace commerce, licensing, learner entitlements, certificates, SEO, deployment, and administrator notifications.</p></div>
          <div className="release-flow"><span>Approve</span><b>→</b><span>Package</span><b>→</b><span>Publish</span><b>→</b><span>Synchronize</span><b>→</b><span>Verify</span></div>
        </section>
      </section>
    </main>
  );
}
