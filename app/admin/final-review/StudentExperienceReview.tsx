"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { StudentCoursePreview } from "@/lib/final-review-types";
import styles from "./final-review.module.css";

type TutorMessage = {
  id: string;
  role: "learner" | "assistant";
  text: string;
  sources?: readonly string[];
  limitations?: readonly string[];
};

type TutorResponse = {
  answer?: string;
  sources?: Array<string | { id?: string; title?: string }>;
  limitations?: string[];
  error?: string;
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return "Duration verified in the staged package";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes} min ${remainder} sec` : `${minutes} min`;
}

function sourceLabels(sources: TutorResponse["sources"]): string[] {
  if (!sources) return [];
  return sources.flatMap((source) => {
    if (typeof source === "string") return source.trim() ? [source.trim()] : [];
    const label = source.title?.trim() || source.id?.trim();
    return label ? [label] : [];
  });
}

export function StudentExperienceReview({ preview }: Readonly<{ preview: StudentCoursePreview }>) {
  const [activeLessonIndex, setActiveLessonIndex] = useState(0);
  const [completedLessons, setCompletedLessons] = useState<ReadonlySet<string>>(() => new Set());
  const [showTranscript, setShowTranscript] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({});
  const [tutorPrompt, setTutorPrompt] = useState("");
  const [tutorPending, setTutorPending] = useState(false);
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I am the Obserrian course coach for this final learner package. Ask for an explanation, an original practice scenario, source grounding, exam reasoning, or a business application example. I will not disclose protected assessment answers.",
    },
  ]);

  const lesson = preview.lessons[activeLessonIndex];
  const progress = Math.round((completedLessons.size / preview.lessons.length) * 100);
  const lessonAssessmentCount = lesson.assessments.length;
  const lessonSourceCount = lesson.sources.length;
  const lessonMaterialCount = lesson.materials.length;
  const orderedLessons = useMemo(
    () => [...preview.lessons].sort((left, right) => left.position - right.position),
    [preview.lessons],
  );

  function selectLesson(index: number) {
    setActiveLessonIndex(index);
    setShowTranscript(false);
    setShowSources(false);
  }

  function toggleLessonComplete() {
    setCompletedLessons((current) => {
      const next = new Set(current);
      if (next.has(lesson.id)) next.delete(lesson.id);
      else next.add(lesson.id);
      return next;
    });
  }

  async function submitTutorPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = tutorPrompt.trim();
    if (!prompt || tutorPending) return;

    const learnerMessage: TutorMessage = {
      id: crypto.randomUUID(),
      role: "learner",
      text: prompt,
    };
    setTutorMessages((current) => [...current, learnerMessage]);
    setTutorPrompt("");
    setTutorPending(true);

    try {
      const response = await fetch(preview.aiTutorEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseSlug: preview.slug,
          lessonId: lesson.id,
          prompt,
          reviewMode: "owner-final",
        }),
      });
      const result = await response.json() as TutorResponse;
      const answer = response.ok && result.answer
        ? result.answer
        : result.error ?? "The governed learner tutor runtime did not return an answer. Final review cannot be approved until the runtime is available and verified.";
      setTutorMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: answer,
          sources: sourceLabels(result.sources),
          limitations: result.limitations ?? [],
        },
      ]);
    } catch {
      setTutorMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "The governed learner tutor runtime is unavailable. The final review gate must remain closed until this connection is verified.",
        },
      ]);
    } finally {
      setTutorPending(false);
    }
  }

  return (
    <section className={styles.studentExperience} aria-label="Final paid learner experience">
      <div className={styles.studentWatermark} aria-hidden="true">
        PAID OBSERRA ACADEMY ACCESS · OBSERRA PROPRIETARY · OWNER FINAL REVIEW
      </div>

      <header className={styles.studentHeader}>
        <div>
          <p className={styles.eyebrow}>OBSERRA ACADEMY · AI NATIVE COURSE</p>
          <h2>{preview.title}</h2>
          <p>{preview.summary}</p>
        </div>
        <div className={styles.studentProgress} aria-label={`${progress}% review progress`}>
          <strong>{progress}%</strong>
          <span>{completedLessons.size}/{preview.lessons.length} lessons reviewed</span>
          <div><i style={{ width: `${progress}%` }} /></div>
        </div>
      </header>

      <div className={styles.studentLayout}>
        <nav className={styles.studentLessonRail} aria-label="Final course lessons">
          <div className={styles.railHeading}>
            <span>COURSE JOURNEY</span>
            <small>Release {preview.releaseVersion}</small>
          </div>
          {orderedLessons.map((item, index) => (
            <button
              className={index === activeLessonIndex ? styles.activeLesson : undefined}
              key={item.id}
              onClick={() => selectLesson(index)}
              type="button"
            >
              <span>{completedLessons.has(item.id) ? "✓" : String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.title}</strong>
                <small>{formatDuration(item.durationSeconds)}</small>
              </div>
            </button>
          ))}
        </nav>

        <main className={styles.studentLessonStage}>
          <div className={styles.videoShell}>
            <div className={styles.videoStatusBar}>
              <span>FINAL MASTER</span>
              <span>AUDIO QA PASSED</span>
              <span>CAPTIONS VERIFIED</span>
              <span>RIGHTS CLEARED</span>
            </div>
            <video
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              key={lesson.id}
              playsInline
              preload="metadata"
            >
              <source src={lesson.videoUrl} type="video/mp4" />
              <track default kind="captions" label="English" src={lesson.captionsUrl} srcLang="en" />
              Your browser does not support the final course video player.
            </video>
          </div>

          <section className={styles.lessonBriefing}>
            <div className={styles.lessonTitleRow}>
              <div>
                <p className={styles.eyebrow}>LESSON {String(activeLessonIndex + 1).padStart(2, "0")}</p>
                <h3>{lesson.title}</h3>
                {lesson.objective ? <p><strong>Objective:</strong> {lesson.objective}</p> : null}
              </div>
              <button className={styles.completeReviewButton} onClick={toggleLessonComplete} type="button">
                {completedLessons.has(lesson.id) ? "Reviewed ✓" : "Mark reviewed"}
              </button>
            </div>
            <p className={styles.lessonOverview}>{lesson.overview}</p>

            <div className={styles.lessonTools}>
              <button onClick={() => setShowTranscript((current) => !current)} type="button">
                {showTranscript ? "Hide transcript" : "Open transcript"}
              </button>
              <button onClick={() => setShowSources((current) => !current)} type="button">
                {showSources ? "Hide sources" : `Show sources (${lessonSourceCount})`}
              </button>
              <span>{lessonMaterialCount} learner materials</span>
              <span>{lessonAssessmentCount} practice items</span>
            </div>

            {showTranscript ? (
              <section className={styles.transcriptPanel}>
                <h4>Verified lesson transcript</h4>
                {lesson.transcript ? <p>{lesson.transcript}</p> : null}
                {lesson.transcriptUrl ? <a href={lesson.transcriptUrl} rel="noreferrer" target="_blank">Open complete transcript</a> : null}
              </section>
            ) : null}

            {showSources ? (
              <section className={styles.sourcePanel}>
                <h4>Authoritative references used in this lesson</h4>
                {lesson.sources.length ? (
                  <ol>
                    {lesson.sources.map((source) => (
                      <li key={source.id}>
                        <strong>{source.authority}</strong> · {source.title}
                        {source.locator ? <span> · {source.locator}</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : <p>No source records are attached. This lesson must not pass final review.</p>}
              </section>
            ) : null}

            {lesson.materials.length ? (
              <section className={styles.materialGrid} aria-label="Learner materials">
                {lesson.materials.map((material) => (
                  <a href={material.href} key={material.id} rel="noreferrer" target="_blank">
                    <span>{material.type}</span>
                    <strong>{material.title}</strong>
                  </a>
                ))}
              </section>
            ) : null}

            {lesson.assessments.length ? (
              <section className={styles.practicePanel}>
                <p className={styles.eyebrow}>ORIGINAL PRACTICE · NO PROTECTED ANSWERS SHOWN</p>
                <h4>Apply the lesson</h4>
                {lesson.assessments.map((assessment, assessmentIndex) => (
                  <fieldset key={assessment.id}>
                    <legend>{assessmentIndex + 1}. {assessment.prompt}</legend>
                    {assessment.options.map((option, optionIndex) => {
                      const value = `${assessment.id}:${optionIndex}`;
                      return (
                        <label key={value}>
                          <input
                            checked={practiceAnswers[assessment.id] === value}
                            name={`review-${assessment.id}`}
                            onChange={() => setPracticeAnswers((current) => ({ ...current, [assessment.id]: value }))}
                            type="radio"
                            value={value}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </section>
            ) : null}
          </section>
        </main>

        <aside className={styles.tutorDock}>
          <div className={styles.tutorHeading}>
            <div className={styles.tutorPulse} aria-hidden="true" />
            <div>
              <p className={styles.eyebrow}>THE OBSERRIAN</p>
              <h3>Course AI Coach</h3>
              <span>Entitlement scoped · source grounded</span>
            </div>
          </div>
          <div className={styles.tutorMessages} aria-live="polite">
            {tutorMessages.map((message) => (
              <article className={message.role === "learner" ? styles.learnerMessage : styles.assistantMessage} key={message.id}>
                <strong>{message.role === "learner" ? "You" : "Obserrian"}</strong>
                <p>{message.text}</p>
                {message.sources?.length ? <small>Sources: {message.sources.join(" · ")}</small> : null}
                {message.limitations?.length ? <small>Limitations: {message.limitations.join(" · ")}</small> : null}
              </article>
            ))}
            {tutorPending ? <article className={styles.assistantMessage}><strong>Obserrian</strong><p>Reviewing the approved course sources…</p></article> : null}
          </div>
          <form className={styles.tutorForm} onSubmit={submitTutorPrompt}>
            <label htmlFor="final-review-tutor-prompt">Ask about this lesson</label>
            <textarea
              id="final-review-tutor-prompt"
              maxLength={2000}
              onChange={(event) => setTutorPrompt(event.target.value)}
              placeholder="Explain the concept, give me an original example, show the source grounding, or apply it to a business scenario."
              value={tutorPrompt}
            />
            <button disabled={tutorPending || !tutorPrompt.trim()} type="submit">
              {tutorPending ? "Analyzing…" : "Ask the Obserrian"}
            </button>
          </form>
          <p className={styles.tutorDisclaimer}>
            Educational assistance only. The tutor will not reveal protected assessment answers or replace authoritative PMI requirements and professional judgment.
          </p>
        </aside>
      </div>

      <footer className={styles.studentFooter}>
        <span>{preview.classification}</span>
        <span>Final package version {preview.releaseVersion}</span>
        <span>Owner review progress is not written to learner records.</span>
      </footer>
    </section>
  );
}
