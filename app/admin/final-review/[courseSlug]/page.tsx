import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canPerformFinalCourseReview } from "@/lib/final-review-auth";
import { finalReviewStudentExperienceUrl } from "@/lib/final-review-student-url";
import { getFinalReviewReadiness } from "@/lib/repositories/final-review-repository";
import { submitFinalReviewDecision } from "../actions";
import styles from "../final-review.module.css";

export const dynamic = "force-dynamic";

export default async function FinalReviewCoursePage({
  params,
}: Readonly<{
  params: Promise<{ courseSlug: string }>;
}>) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/select-organization");
  if (!canPerformFinalCourseReview(userId, orgRole)) redirect("/");

  const { courseSlug } = await params;
  const [readiness, studentExperienceUrl] = await Promise.all([
    getFinalReviewReadiness(orgId, courseSlug),
    Promise.resolve(finalReviewStudentExperienceUrl(courseSlug)),
  ]);

  if (!readiness?.ready || !readiness.preview || !studentExperienceUrl) notFound();
  const preview = readiness.preview;

  return (
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <span>OBSERRA</span>
          <strong>ACADEMY FINAL REVIEW</strong>
          <small>Exact paid learner experience</small>
        </div>
        <div className={styles.actions}>
          <Link className={styles.link} href="/admin/final-review">Back to Final Review Queue</Link>
          <a
            className={styles.primaryLink}
            href={studentExperienceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open student experience in new window
          </a>
        </div>
      </div>

      <section className={styles.content}>
        <header className={styles.reviewHeader}>
          <div>
            <p className={styles.eyebrow}>OWNER FINAL REVIEW · PAID LEARNER EXPERIENCE</p>
            <h1>{preview.title}</h1>
            <p>
              This frame loads the staged learner route used after paid entitlement. It is not a
              script view, internal storyboard, static approximation, or prototype. Approval records
              your owner decision but does not publish the course.
            </p>
          </div>
          <div className={styles.reviewFacts}>
            <span>Release {preview.releaseVersion}</span>
            <span>{preview.lessons.length} final lessons</span>
            <span>Quality {preview.qualityScore}%</span>
            <span>{preview.accessLabel}</span>
            <span>{preview.classification}</span>
          </div>
        </header>

        <section className={styles.experienceFrame} aria-label="Exact staged paid learner experience">
          <div className={styles.frameLabel}>
            OWNER REVIEW FRAME · EXACT STAGED STUDENT ROUTE · NO AUTOMATIC PUBLICATION
          </div>
          <iframe
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
            src={studentExperienceUrl}
            title={`${preview.title} paid learner experience`}
          />
        </section>

        <div className={styles.reviewGrid}>
          <section className={styles.reviewPanel}>
            <p className={styles.eyebrow}>FINAL GATE SCOPE</p>
            <h2>Review the complete learner journey</h2>
            <ul>
              <li>Enrollment and entitlement-protected course access.</li>
              <li>Final video playback, narration, music, audio levels, captions, and transcripts.</li>
              <li>Lesson order, instructional content, facts, source references, and business examples.</li>
              <li>Obserra branding, ownership markings, disclaimers, and paid-content notices.</li>
              <li>Course-specific AI tutor behavior, grounding, citations, and assessment lockout.</li>
              <li>Practice activities, final assessment, completion standard, and certificate workflow.</li>
              <li>Desktop and mobile usability, accessibility, and overall production quality.</li>
            </ul>
            <p>
              The staged package is available for controlled evidence review at{" "}
              <a href={preview.releasePackageUrl} rel="noreferrer" target="_blank">
                the immutable release package
              </a>
              .
            </p>
          </section>

          <section className={styles.reviewPanel}>
            <p className={styles.eyebrow}>OWNER DECISION</p>
            <h2>Approve or return to production</h2>
            <form action={submitFinalReviewDecision} className={styles.decisionForm}>
              <input name="courseSlug" type="hidden" value={preview.slug} />
              <textarea
                aria-label="Final review notes"
                name="notes"
                placeholder="Record approval notes or describe every required change. Notes are mandatory when returning the course to production."
              />
              <label className={styles.confirmation}>
                <input name="studentExperienceReviewed" required type="checkbox" value="confirmed" />
                <span>I reviewed the actual staged experience presented to an entitled paying learner.</span>
              </label>
              <label className={styles.confirmation}>
                <input name="noAutomaticPublication" required type="checkbox" value="confirmed" />
                <span>I understand this decision does not automatically publish the course or open checkout.</span>
              </label>
              <div className={styles.decisionActions}>
                <button className={styles.changeButton} name="decision" type="submit" value="changes-required">
                  Return for changes
                </button>
                <button className={styles.decisionButton} name="decision" type="submit" value="approve">
                  Approve final learner experience
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
