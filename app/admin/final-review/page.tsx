import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canPerformFinalCourseReview } from "@/lib/final-review-auth";
import { finalReviewStudentExperienceUrl } from "@/lib/final-review-student-url";
import { getFinalReviewQueue } from "@/lib/repositories/final-review-repository";
import styles from "./final-review.module.css";

export const dynamic = "force-dynamic";

function decisionMessage(
  decision: string | string[] | undefined,
  course: string | string[] | undefined,
  release: string | string[] | undefined,
): string | null {
  const normalizedDecision = Array.isArray(decision) ? decision[0] : decision;
  const normalizedCourse = Array.isArray(course) ? course[0] : course;
  const normalizedRelease = Array.isArray(release) ? release[0] : release;
  if (!normalizedDecision || !normalizedCourse) return null;
  return normalizedDecision === "approve"
    ? `${normalizedCourse} release ${normalizedRelease ?? ""} passed owner final review. Publication was not triggered.`
    : `${normalizedCourse} was returned to production with required changes.`;
}

export default async function FinalReviewQueuePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/select-organization");
  if (!canPerformFinalCourseReview(userId, orgRole)) redirect("/");

  const [queue, resolvedSearchParams] = await Promise.all([
    getFinalReviewQueue(orgId),
    searchParams,
  ]);
  const finalReviewEnvironmentConfigured = Boolean(
    finalReviewStudentExperienceUrl("configuration-check"),
  );
  const message = decisionMessage(
    resolvedSearchParams.decision,
    resolvedSearchParams.course,
    resolvedSearchParams.release,
  );

  return (
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <span>OBSERRA</span>
          <strong>ACADEMY FINAL REVIEW</strong>
          <small>Owner-only learner experience gate</small>
        </div>
        <div className={styles.actions}>
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/admin/final-review"
            afterCreateOrganizationUrl="/admin/final-review"
          />
          <UserButton />
          <Link className={styles.link} href="/">Return to Mission Control</Link>
        </div>
      </div>

      <section className={styles.content}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>FINAL LEARNER EXPERIENCE</p>
          <h1>Review only what a paying student will actually receive.</h1>
          <p>
            Draft scripts, prototypes, partial videos, incomplete audio, and internal production
            artifacts are intentionally excluded. A course appears here only after every required
            review, quality gate, final media check, learner entitlement test, AI tutor test, and
            staged release requirement has passed.
          </p>
        </header>

        {message ? <div className={styles.notice}>{message}</div> : null}

        {!finalReviewEnvironmentConfigured ? (
          <section className={styles.empty}>
            <p className={styles.eyebrow}>FAIL-CLOSED CONFIGURATION</p>
            <h2>The exact student review environment is not configured.</h2>
            <p>
              Set the approved HTTPS learner-preview origin before any course can be presented for
              owner final review. No fallback mockup or internal script view will be substituted.
            </p>
          </section>
        ) : queue.length === 0 ? (
          <section className={styles.empty}>
            <p className={styles.eyebrow}>NO FINAL REVIEW ITEMS</p>
            <h2>Nothing is ready for your final review yet.</h2>
            <p>
              Production continues behind the gate. The PMP course will appear automatically only
              when the complete paid learner experience is staged, verified, and ready for an owner
              decision.
            </p>
          </section>
        ) : (
          <section className={styles.queue} aria-label="Courses ready for owner final review">
            {queue.map((item) => (
              <article className={styles.queueItem} key={item.slug}>
                <div>
                  <p className={styles.eyebrow}>READY FOR OWNER REVIEW</p>
                  <h2>{item.title}</h2>
                  <div className={styles.meta}>
                    <span>Release {item.releaseVersion}</span>
                    <span>{item.lessonCount} final lessons</span>
                    <span>Quality {item.qualityScore}%</span>
                    <span>Ready {new Date(item.readyAt).toLocaleString()}</span>
                  </div>
                </div>
                <Link
                  className={styles.primaryLink}
                  href={`/admin/final-review/${encodeURIComponent(item.slug)}`}
                >
                  Open exact student experience
                </Link>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
