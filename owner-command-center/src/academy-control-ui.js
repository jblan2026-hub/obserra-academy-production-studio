"use strict";

(() => {
  const REFRESH_INTERVAL_MS = 30000;
  const state = {
    snapshot: null,
    selectedCourseId: null,
    search: "",
    filter: "all",
    busy: false,
    lastResult: null,
    lastError: null,
    refreshTimer: null,
  };

  const root = document.getElementById("academyLifecyclePanel");
  if (!root || !window.obserraOwner?.getAcademyControlSnapshot) return;

  const elements = {
    metrics: document.getElementById("academyLifecycleMetrics"),
    search: document.getElementById("academyLifecycleSearch"),
    filter: document.getElementById("academyLifecycleFilter"),
    refresh: document.getElementById("academyLifecycleRefresh"),
    list: document.getElementById("academyLifecycleList"),
    detail: document.getElementById("academyLifecycleDetail"),
    audit: document.getElementById("academyLifecycleAudit"),
    updated: document.getElementById("academyLifecycleUpdated"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "Not recorded";
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString();
  }

  function formatMoney(value, currency = "USD") {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(amount);
  }

  function statusClass(value) {
    const normalized = String(value || "").toLowerCase();
    if (["published", "approved", "generated", "verified-success", "operational"].includes(normalized)) return "ok";
    if (["in-review", "queued", "running", "changes-requested", "paid-pending-account-claim"].includes(normalized)) return "warn";
    if (["failed", "rejected", "verification-failed", "verification-timeout", "retired"].includes(normalized)) return "bad";
    return "neutral";
  }

  function courseJob(courseId) {
    const jobs = Object.values(state.snapshot?.publicationJobs || {})
      .filter((job) => job.courseId === courseId)
      .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
    return jobs[0] || null;
  }

  function filteredCourses() {
    const search = state.search.trim().toLowerCase();
    return (state.snapshot?.courses || []).filter((course) => {
      const releaseStatus = String(course.release?.status || course.releaseStatus || "draft");
      if (state.filter !== "all" && releaseStatus !== state.filter) return false;
      if (!search) return true;
      return [course.id, course.title, course.department, course.track, course.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }

  function renderMetrics() {
    if (!state.snapshot) {
      elements.metrics.innerHTML = '<div class="academyControlLoading">Loading authoritative course control state…</div>';
      return;
    }
    const courses = state.snapshot.courses || [];
    const count = (status) => courses.filter((course) => (course.release?.status || course.releaseStatus) === status).length;
    const blocked = courses.filter((course) => (course.publicationBlockers || []).length > 0).length;
    const activeJobs = Object.values(state.snapshot.publicationJobs || {}).filter((job) => ["queued", "running"].includes(job.state)).length;
    const commerce = state.snapshot.commerce;
    elements.metrics.innerHTML = [
      ["TOTAL COURSES", courses.length, "Complete governed course inventory"],
      ["IN REVIEW", count("in-review"), "Courses awaiting one or more owner review decisions"],
      ["APPROVED", count("approved"), "Approved but not publicly published"],
      ["PUBLISHED", count("published"), "Manifest and catalog state marked published"],
      ["BLOCKED", blocked, "Courses with unresolved publication requirements"],
      ["LIVE RELEASE JOBS", activeJobs, "GitHub and website verification still running"],
      ["COMMERCE", commerce?.operational ? "OPERATIONAL" : "BLOCKED", commerce?.rawBody || "Commerce health has not been checked"],
    ]
      .map(([label, value, detail]) => `
        <article class="academyControlMetric ${statusClass(value)}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small title="${escapeHtml(detail)}">${escapeHtml(detail)}</small>
        </article>
      `)
      .join("");
  }

  function renderList() {
    const courses = filteredCourses();
    if (!courses.length) {
      elements.list.innerHTML = '<div class="academyControlEmpty">No courses match the selected search and release filter.</div>';
      return;
    }
    elements.list.innerHTML = courses
      .map((course) => {
        const selected = course.id === state.selectedCourseId;
        const releaseStatus = course.release?.status || course.releaseStatus || "draft";
        const job = courseJob(course.id);
        return `
          <button class="academyControlCourse ${selected ? "selected" : ""}" data-course-id="${escapeHtml(course.id)}">
            <span class="academyControlCourseTitle">${escapeHtml(course.title)}</span>
            <span class="academyControlCourseId">${escapeHtml(course.id)}</span>
            <span class="academyControlCourseStates">
              <span class="academyState ${statusClass(releaseStatus)}">${escapeHtml(releaseStatus)}</span>
              <span class="academyState ${course.publicationReady ? "ok" : "warn"}">${course.publicationReady ? "release ready" : `${course.publicationBlockers.length} blocker(s)`}</span>
              ${job ? `<span class="academyState ${statusClass(job.state)}">${escapeHtml(job.state)}</span>` : ""}
            </span>
          </button>
        `;
      })
      .join("");
  }

  function reviewCard(course, review) {
    const status = String(review.status || "not-started");
    return `
      <article class="academyReviewCard">
        <div class="academyReviewHeader">
          <strong>${escapeHtml(review.name)}</strong>
          <span class="academyState ${statusClass(status)}">${escapeHtml(status)}</span>
        </div>
        <p>${escapeHtml(review.note || "No owner review note has been recorded.")}</p>
        <small>${review.reviewedBy ? `${escapeHtml(review.reviewedBy)} · ${escapeHtml(formatDate(review.reviewedAt))}` : "No attributable review decision recorded"}</small>
        <div class="academyReviewActions">
          <button data-review-name="${escapeHtml(review.name)}" data-review-decision="approved">Approve</button>
          <button class="secondary" data-review-name="${escapeHtml(review.name)}" data-review-decision="changes-requested">Request changes</button>
          <button class="danger" data-review-name="${escapeHtml(review.name)}" data-review-decision="rejected">Reject</button>
          <button class="secondary" data-review-name="${escapeHtml(review.name)}" data-review-decision="not-started">Reset</button>
        </div>
      </article>
    `;
  }

  function publicationJobPanel(job) {
    if (!job) return '<div class="academyControlNotice">No publication or unpublication job has been submitted for this course.</div>';
    const technical = job.error || job.readback || {};
    return `
      <div class="academyPublicationJob">
        <div><strong>Latest release job</strong><span class="academyState ${statusClass(job.state)}">${escapeHtml(job.state)}</span></div>
        <p>Action: ${escapeHtml(job.action)} · Commit: ${escapeHtml(job.commitSha || "not recorded")}</p>
        <p>Workflow: ${escapeHtml(job.workflowConclusion || job.workflowStatus || "awaiting discovery")} · Updated: ${escapeHtml(formatDate(job.updatedAt))}</p>
        ${job.workflowUrl ? `<p><a href="${escapeHtml(job.workflowUrl)}">Open GitHub workflow evidence</a></p>` : ""}
        <details><summary>Technical verification evidence</summary><pre>${escapeHtml(JSON.stringify(technical, null, 2))}</pre></details>
      </div>
    `;
  }

  function renderDetail() {
    const course = (state.snapshot?.courses || []).find((item) => item.id === state.selectedCourseId);
    if (!course) {
      elements.detail.innerHTML = '<div class="academyControlEmpty">Select a course to review its complete lifecycle, release, commerce, and purchase state.</div>';
      return;
    }
    const releaseStatus = course.release?.status || course.releaseStatus || "draft";
    const job = courseJob(course.id);
    const blockers = course.publicationBlockers || [];
    elements.detail.innerHTML = `
      <div class="academyControlDetailHeader">
        <div>
          <p class="eyebrow">${escapeHtml(course.department || "Academy")}</p>
          <h3>${escapeHtml(course.title)}</h3>
          <p class="courseDescription">${escapeHtml(course.description || "No course description recorded.")}</p>
        </div>
        <div class="academyControlStatusStack">
          <span class="academyState ${statusClass(releaseStatus)}">${escapeHtml(releaseStatus)}</span>
          <span class="academyState ${course.release?.publishToAcademy ? "ok" : "neutral"}">${course.release?.publishToAcademy ? "public purchase enabled" : "new purchase disabled"}</span>
        </div>
      </div>

      <div class="academyControlFacts">
        <div><span>Course ID</span><strong>${escapeHtml(course.id)}</strong></div>
        <div><span>Version</span><strong>${escapeHtml(course.release?.version || course.version || "not recorded")}</strong></div>
        <div><span>Modules</span><strong>${escapeHtml(course.moduleCount)}</strong></div>
        <div><span>Duration</span><strong>${escapeHtml(course.duration)}</strong></div>
        <div><span>Price</span><strong>${escapeHtml(formatMoney(course.commerce?.price, course.commerce?.currency))}</strong></div>
        <div><span>Reviews</span><strong>${escapeHtml(course.reviewCompletion)}%</strong></div>
      </div>

      <div class="academyControlSection">
        <div class="academyControlSectionTitle"><h4>Build and release controls</h4><span>${blockers.length ? `${blockers.length} blocker(s)` : "All deterministic release requirements satisfied"}</span></div>
        <div class="academyBlockerList">${blockers.length ? blockers.map((blocker) => `<span>${escapeHtml(blocker)}</span>`).join("") : '<span class="clear">No deterministic publication blockers</span>'}</div>
        <div class="academyReleaseActions">
          <button data-course-action="author">Generate</button>
          <button data-course-action="revise" class="aiRevision">AI revise</button>
          <button data-course-action="build">Build release</button>
          <button data-release-action="submit-review" class="secondary">Submit for review</button>
          <button data-release-action="approve">Approve release</button>
          <button data-release-action="publish">Publish live</button>
          <button data-release-action="unpublish" class="secondary">Unpublish new sales</button>
          <button data-release-action="retire" class="danger">Retire</button>
          <button data-release-action="restore-draft" class="secondary">Restore draft</button>
        </div>
        <p class="academyControlBoundary">Unpublishing or retiring removes the course from new public purchase access. Existing paid entitlements are not deleted or disabled.</p>
      </div>

      <div class="academyControlSection">
        <div class="academyControlSectionTitle"><h4>Required reviews</h4><span>Every decision is attributable and written to the tamper-evident owner ledger.</span></div>
        <div class="academyReviewGrid">${(course.reviews || []).map((review) => reviewCard(course, review)).join("") || '<div class="academyControlNotice">No review definitions were found in the course manifest.</div>'}</div>
      </div>

      <div class="academyControlSection">
        <div class="academyControlSectionTitle"><h4>Commerce and paid-access verification</h4><span>Verified Success requires Stripe paid state, Clerk entitlement readback, and operational Academy commerce health.</span></div>
        <div class="academyCommerceFacts">
          <span>Stripe price: ${escapeHtml(course.commerce?.stripePriceId || "not configured")}</span>
          <span>Payment link: ${escapeHtml(course.commerce?.paymentLink || "not configured")}</span>
        </div>
        <div class="academyPurchaseControls">
          <input id="academyCheckoutSessionId" type="text" autocomplete="off" placeholder="Stripe Checkout Session ID, for example cs_live_…" />
          <button data-purchase-action="verify">Verify paid access end to end</button>
          <button data-purchase-action="list" class="secondary">List recent course purchases</button>
        </div>
      </div>

      <div class="academyControlSection">
        <div class="academyControlSectionTitle"><h4>Release verification</h4><span>Dashboard status changes to Verified Success only after GitHub Actions, catalog, website, and commerce readback.</span></div>
        ${publicationJobPanel(job)}
      </div>
    `;
  }

  function renderAudit() {
    const value = state.lastError
      ? { state: "error", technicalReason: state.lastError }
      : state.lastResult || {
          state: "ready",
          message: "Select a course action. Exact provider responses and verification evidence will appear here.",
          latestLedgerEvents: state.snapshot?.ledger?.slice(0, 10) || [],
        };
    elements.audit.textContent = JSON.stringify(value, null, 2);
    elements.audit.classList.toggle("error", Boolean(state.lastError));
  }

  function render() {
    renderMetrics();
    renderList();
    renderDetail();
    renderAudit();
    elements.updated.textContent = state.snapshot
      ? `Last authoritative refresh: ${formatDate(state.snapshot.generatedAt)} · automatic refresh every 30 seconds`
      : "Authoritative course state unavailable";
    root.classList.toggle("busy", state.busy);
  }

  async function refresh({ preserveResult = true } = {}) {
    if (state.busy) return;
    state.busy = true;
    if (!preserveResult) {
      state.lastResult = null;
      state.lastError = null;
    }
    render();
    try {
      const snapshot = await window.obserraOwner.getAcademyControlSnapshot();
      state.snapshot = snapshot;
      if (!state.selectedCourseId || !snapshot.courses.some((course) => course.id === state.selectedCourseId)) {
        state.selectedCourseId = snapshot.courses[0]?.id || null;
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function execute(label, operation) {
    if (state.busy) return;
    state.busy = true;
    state.lastError = null;
    state.lastResult = { state: "executing", action: label, startedAt: new Date().toISOString() };
    render();
    try {
      const result = await operation();
      state.lastResult = result;
      if (result?.ok === false) {
        state.lastError = JSON.stringify(result.providerError || result, null, 2);
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      await refresh();
    }
  }

  elements.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderList();
  });
  elements.filter.addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderList();
  });
  elements.refresh.addEventListener("click", () => refresh({ preserveResult: false }));
  elements.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-course-id]");
    if (!button) return;
    state.selectedCourseId = button.dataset.courseId;
    render();
  });

  elements.detail.addEventListener("click", async (event) => {
    const course = (state.snapshot?.courses || []).find((item) => item.id === state.selectedCourseId);
    if (!course) return;

    const reviewButton = event.target.closest("[data-review-decision]");
    if (reviewButton) {
      const decision = reviewButton.dataset.reviewDecision;
      const reviewName = reviewButton.dataset.reviewName;
      const note = window.prompt(`Owner note for ${reviewName} → ${decision}:`);
      if (!note) return;
      await execute("review-decision", () => window.obserraOwner.updateAcademyReview({
        courseId: course.id,
        reviewName,
        decision,
        note,
      }));
      return;
    }

    const courseActionButton = event.target.closest("[data-course-action]");
    if (courseActionButton) {
      const action = courseActionButton.dataset.courseAction;
      await execute(`course-${action}`, () => window.obserraOwner.runAcademyAction({ action, courseId: course.id }));
      return;
    }

    const releaseButton = event.target.closest("[data-release-action]");
    if (releaseButton) {
      const action = releaseButton.dataset.releaseAction;
      const note = window.prompt(`Owner reason for ${action} on ${course.id}:`);
      if (!note) return;
      let confirmation = "";
      if (action === "publish") confirmation = window.prompt(`Enter exactly: PUBLISH ${course.id}`) || "";
      if (action === "unpublish") confirmation = window.prompt(`Enter exactly: UNPUBLISH ${course.id}`) || "";
      if (action === "retire") confirmation = window.prompt(`Enter exactly: RETIRE ${course.id}`) || "";
      if (action === "restore-draft") confirmation = window.prompt(`Enter exactly: RESTORE ${course.id}`) || "";
      await execute(`release-${action}`, () => window.obserraOwner.transitionAcademyCourse({
        courseId: course.id,
        action,
        note,
        confirmation,
      }));
      return;
    }

    const purchaseButton = event.target.closest("[data-purchase-action]");
    if (purchaseButton) {
      const action = purchaseButton.dataset.purchaseAction;
      if (action === "list") {
        await execute("list-course-purchases", () => window.obserraOwner.listAcademyPurchases({ courseId: course.id }));
        return;
      }
      const sessionId = document.getElementById("academyCheckoutSessionId")?.value?.trim();
      if (!sessionId) {
        state.lastError = "Enter the Stripe Checkout Session ID that must be verified.";
        renderAudit();
        return;
      }
      await execute("verify-purchase", () => window.obserraOwner.verifyAcademyPurchase({
        courseId: course.id,
        sessionId,
      }));
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });

  state.refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_INTERVAL_MS);

  refresh({ preserveResult: false });
})();
