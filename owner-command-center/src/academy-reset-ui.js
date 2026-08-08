"use strict";

(() => {
  const state = {
    snapshot: null,
    endpoint: null,
    selectedCourseId: null,
    search: "",
    filter: "all",
    busy: false,
    lastResult: null,
    lastError: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    endpoint: $("endpointState"),
    enroll: $("enrollEndpoint"),
    privacy: $("privacyState"),
    workspace: $("workspaceState"),
    metrics: $("academyMetrics"),
    search: $("academySearch"),
    filter: $("academyFilter"),
    refresh: $("academyRefresh"),
    list: $("courseList"),
    detail: $("courseDetail"),
    evidence: $("evidence"),
    dialog: $("previewDialog"),
    previewTitle: $("previewTitle"),
    previewBody: $("previewBody"),
    previewClose: $("previewClose"),
  };

  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function generation(course) {
    return typeof course?.generation === "object"
      ? String(course.generation.status || "not-generated")
      : String(course?.generation || "not-generated");
  }

  function release(course) {
    return String(course?.release?.status || course?.releaseStatus || "draft");
  }

  function version(course) {
    return String(course?.release?.version || course?.version || "1.0.0");
  }

  function stage(course) {
    if (release(course) === "published") return "live";
    if (release(course) === "approved") return "approved";
    if (generation(course) !== "generated") return "building";
    if ((course?.publicationBlockers || []).length) return "blocked";
    return "needs-review";
  }

  function cls(value) {
    const v = String(value || "").toLowerCase();
    if (["live", "approved", "generated", "verified-success", "operational", "enrolled"].includes(v)) return "ok";
    if (["needs-review", "in-review", "building", "queued", "running", "paid-pending-account-claim"].includes(v)) return "warn";
    if (["blocked", "failed", "rejected", "retired", "verification-failed", "certificate-contract-mismatch"].includes(v)) return "bad";
    return "neutral";
  }

  function selected() {
    return (state.snapshot?.courses || []).find((course) => course.id === state.selectedCourseId) || null;
  }

  function filtered() {
    const query = state.search.trim().toLowerCase();
    return (state.snapshot?.courses || []).filter((course) => {
      if (state.filter !== "all" && stage(course) !== state.filter) return false;
      if (!query) return true;
      return [course.id, course.title, course.department, course.track, course.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }

  function requiredReviews(course) {
    return (course?.reviews || []).filter((review) => review?.required !== false);
  }

  function optionalReviews(course) {
    return (course?.reviews || []).filter((review) => review?.required === false);
  }

  function renderHeader() {
    const enrollment = state.endpoint?.enrollment?.state || "not-enrolled";
    const ready = state.endpoint?.endpointReady === true;
    el.endpoint.className = `statusPill ${cls(ready ? "enrolled" : enrollment)}`;
    el.endpoint.textContent = ready ? "Owner endpoint ready" : `Endpoint: ${enrollment}`;
    el.enroll.hidden = ready;
    el.privacy.textContent = state.snapshot?.privacyBoundary || "Sensitive payment, customer, and student data is excluded from this owner console.";
    el.workspace.textContent = state.snapshot?.root ? `Workspace: ${state.snapshot.root}` : "Academy workspace unavailable";
  }

  function renderMetrics() {
    const courses = state.snapshot?.courses || [];
    const count = (name) => courses.filter((course) => stage(course) === name).length;
    el.metrics.innerHTML = [
      ["TOTAL", courses.length, "All Academy courses"],
      ["BUILDING", count("building"), "Generation or release build incomplete"],
      ["NEEDS REVIEW", count("needs-review"), "Ready for owner review"],
      ["BLOCKED", count("blocked"), "One or more release blockers"],
      ["APPROVED", count("approved"), "Approved, not yet live"],
      ["LIVE", count("live"), "Published to Academy"],
    ].map(([label, value, note]) => `<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("");
  }

  function renderList() {
    const courses = filtered();
    el.list.innerHTML = courses.length ? courses.map((course) => {
      const current = stage(course);
      const blockers = course.publicationBlockers?.length || 0;
      return `<button class="courseRow ${course.id === state.selectedCourseId ? "selected" : ""}" data-course-id="${esc(course.id)}">
        <strong>${esc(course.title)}</strong>
        <small>${esc(course.id)} · v${esc(version(course))}</small>
        <span class="courseStates"><span class="statusPill ${cls(current)}">${esc(current)}</span>${blockers ? `<span class="statusPill bad">${blockers} blocker(s)</span>` : ""}</span>
      </button>`;
    }).join("") : '<div class="empty">No courses match this filter.</div>';
  }

  function reviewCard(review, required) {
    const status = String(review.status || "not-started");
    return `<article class="reviewCard ${required ? "" : "optional"}">
      <div class="reviewHead"><strong>${esc(review.name)}</strong><span class="statusPill ${cls(status)}">${esc(status)}</span></div>
      <small>${required ? "Required review" : "Optional review · does not block publication"}</small>
      <p>${esc(review.note || review.notes || "No owner note recorded.")}</p>
      ${required ? `<div class="actions"><button data-review-name="${esc(review.name)}" data-review-decision="approved">Approve</button><button class="secondary" data-review-name="${esc(review.name)}" data-review-decision="changes-requested">Request changes</button><button class="danger" data-review-name="${esc(review.name)}" data-review-decision="rejected">Reject</button></div>` : ""}
    </article>`;
  }

  function renderDetail() {
    const course = selected();
    if (!course) {
      el.detail.innerHTML = '<div class="empty">Select a course to review.</div>';
      return;
    }

    const current = stage(course);
    const blockers = course.publicationBlockers || [];
    const required = requiredReviews(course);
    const optional = optionalReviews(course);
    const commerce = course.commerce || {};

    el.detail.innerHTML = `
      <div class="courseHero"><div><p class="eyebrow">${esc(course.department || "OBSERRA ACADEMY")}</p><h2>${esc(course.title)}</h2><p>${esc(course.description || "No description recorded.")}</p></div><span class="statusPill large ${cls(current)}">${esc(current)}</span></div>
      <div class="facts"><div><span>Course ID</span><strong>${esc(course.id)}</strong></div><div><span>Version</span><strong>v${esc(version(course))}</strong></div><div><span>Generation</span><strong>${esc(generation(course))}</strong></div><div><span>Release</span><strong>${esc(release(course))}</strong></div><div><span>Modules</span><strong>${esc(course.moduleCount ?? "-")}</strong></div><div><span>Price</span><strong>${esc(commerce.currency || "USD")} ${esc(commerce.price ?? course.price ?? "-")}</strong></div></div>

      <section><div class="sectionTitle"><div><p class="eyebrow">LEARNER PREVIEW</p><h3>Review what will go live</h3></div></div><div class="actions"><button data-preview="course">Preview course</button><button class="secondary" data-preview="materials">Preview materials</button><button class="secondary" data-preview="certificate">Preview certificate</button></div></section>

      <section><div class="sectionTitle"><div><p class="eyebrow">LIVE WEBSITE READBACK</p><h3>Compare published customer-facing data</h3></div></div><p class="boundary">Retrieval is HTTPS-only, same-origin constrained, redirect-denied, size-bounded, and privacy filtered before display.</p><div class="actions"><button data-website-action="course">Load published website course</button></div><div class="paymentRow"><input id="certificateReference" type="password" autocomplete="off" spellcheck="false" placeholder="OBS-... certificate ID" /><button class="secondary" data-website-action="certificate">Load certificate verification</button></div></section>

      <section><div class="sectionTitle"><div><p class="eyebrow">RELEASE READINESS</p><h3>Deterministic blockers</h3></div><span>${blockers.length ? `${blockers.length} unresolved` : "Clear"}</span></div><div class="blockers">${blockers.length ? blockers.map((item) => `<span>${esc(item)}</span>`).join("") : '<span class="clear">No deterministic publication blockers</span>'}</div><div class="actions"><button data-course-action="build">Build release</button><button class="secondary" data-course-action="revise">AI revise</button><button class="secondary" data-course-action="verify">Verify course</button></div></section>

      <section><div class="sectionTitle"><div><p class="eyebrow">REQUIRED REVIEWS</p><h3>Owner decisions</h3></div><span>${required.length} required</span></div><div class="reviewGrid">${required.map((review) => reviewCard(review, true)).join("") || '<div class="empty">No required reviews.</div>'}</div>${optional.length ? `<details><summary>${optional.length} optional review(s)</summary><div class="reviewGrid">${optional.map((review) => reviewCard(review, false)).join("")}</div></details>` : ""}</section>

      <section><div class="sectionTitle"><div><p class="eyebrow">OWNER RELEASE CONTROL</p><h3>Approve and publish</h3></div></div><p class="boundary">Approval does not publish. Publication is fail-closed and requires explicit owner confirmation plus independent provider/readback verification.</p><div class="actions"><button class="secondary" data-release-action="submit-review">Submit for review</button><button data-release-action="approve">Approve release</button><button class="publish" data-release-action="publish">Publish live</button><button class="secondary" data-release-action="unpublish">Unpublish</button></div></section>

      <section><div class="sectionTitle"><div><p class="eyebrow">SECURE PURCHASE VERIFICATION</p><h3>Validate a real paid enrollment</h3></div></div><p class="boundary">Enter a Stripe PaymentIntent (pi_...) or Checkout Session (cs_...). The reference is runtime-only. Customer email, card data, payment-method details, raw provider records, and full transaction references are excluded from owner-facing evidence.</p><div class="paymentRow"><input id="paymentReference" type="password" autocomplete="off" spellcheck="false" placeholder="pi_... or cs_..." /><button data-purchase-action="verify">Verify paid access</button></div></section>
    `;
  }

  function renderEvidence() {
    const value = state.lastError
      ? { state: "error", message: state.lastError }
      : state.lastResult || { state: "ready", message: "Select a course and action.", privacy: "Sensitive customer and payment data is excluded from owner-facing evidence." };
    el.evidence.textContent = JSON.stringify(value, null, 2);
    el.evidence.classList.toggle("error", Boolean(state.lastError));
  }

  function render() {
    renderHeader();
    renderMetrics();
    renderList();
    renderDetail();
    renderEvidence();
    document.body.classList.toggle("busy", state.busy);
  }

  async function refresh() {
    try {
      const [endpoint, snapshot] = await Promise.all([
        window.obserraOwner.getEndpointSnapshot(),
        window.obserraOwner.getAcademyControlSnapshot(),
      ]);
      state.endpoint = endpoint;
      state.snapshot = snapshot;
      if (!state.selectedCourseId || !snapshot.courses?.some((course) => course.id === state.selectedCourseId)) {
        state.selectedCourseId = snapshot.courses?.[0]?.id || null;
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
    render();
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
      if (result?.ok === false) state.lastError = result.reason || result.state || "Operation failed.";
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      await refresh();
    }
  }

  async function openPreview(kind) {
    const course = selected();
    if (!course) return;
    const operation = kind === "course"
      ? window.obserraOwner.previewAcademyCourse
      : kind === "materials"
        ? window.obserraOwner.previewAcademyMaterials
        : window.obserraOwner.previewAcademyCertificate;
    try {
      const result = await operation(course.id);
      el.previewTitle.textContent = `${course.title} · ${kind}`;
      el.previewBody.textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      el.dialog.showModal();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      renderEvidence();
    }
  }

  el.enroll.addEventListener("click", async () => {
    const confirmation = window.prompt("Enter exactly: ENROLL THIS ENDPOINT");
    if (!confirmation) return;
    await execute("endpoint-enrollment", () => window.obserraOwner.enrollEndpoint({ confirmation }));
  });

  el.search.addEventListener("input", (event) => { state.search = event.target.value; renderList(); });
  el.filter.addEventListener("change", (event) => { state.filter = event.target.value; renderList(); });
  el.refresh.addEventListener("click", refresh);
  el.previewClose.addEventListener("click", () => el.dialog.close());

  el.list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-course-id]");
    if (!row) return;
    state.selectedCourseId = row.dataset.courseId;
    render();
  });

  el.detail.addEventListener("click", async (event) => {
    const course = selected();
    if (!course) return;

    const preview = event.target.closest("[data-preview]");
    if (preview) return openPreview(preview.dataset.preview);

    const websiteAction = event.target.closest("[data-website-action]");
    if (websiteAction?.dataset.websiteAction === "course") {
      return execute("website-course-readback", () => window.obserraOwner.retrieveWebsiteAcademyCourse(course.id));
    }
    if (websiteAction?.dataset.websiteAction === "certificate") {
      const input = document.getElementById("certificateReference");
      const certificateId = String(input?.value || "").trim();
      if (!certificateId) {
        state.lastError = "Enter a certificate ID to verify.";
        return renderEvidence();
      }
      input.value = "";
      return execute("website-certificate-readback", () => window.obserraOwner.retrieveWebsiteAcademyCertificate(certificateId));
    }

    const review = event.target.closest("[data-review-decision]");
    if (review) {
      const note = window.prompt(`Owner note for ${review.dataset.reviewName} -> ${review.dataset.reviewDecision}:`);
      if (!note) return;
      return execute("review-decision", () => window.obserraOwner.updateAcademyReview({
        courseId: course.id,
        reviewName: review.dataset.reviewName,
        decision: review.dataset.reviewDecision,
        note,
      }));
    }

    const courseAction = event.target.closest("[data-course-action]");
    if (courseAction) {
      return execute(`course-${courseAction.dataset.courseAction}`, () => window.obserraOwner.runAcademyControlledAction({
        action: courseAction.dataset.courseAction,
        courseId: course.id,
      }));
    }

    const releaseAction = event.target.closest("[data-release-action]");
    if (releaseAction) {
      const action = releaseAction.dataset.releaseAction;
      const note = window.prompt(`Owner reason for ${action} on ${course.id}:`);
      if (!note) return;
      let confirmation = "";
      if (action === "publish") confirmation = window.prompt(`Enter exactly: PUBLISH ${course.id}`) || "";
      if (action === "unpublish") confirmation = window.prompt(`Enter exactly: UNPUBLISH ${course.id}`) || "";
      return execute(`release-${action}`, () => window.obserraOwner.transitionAcademyCourse({
        courseId: course.id,
        action,
        note,
        confirmation,
      }));
    }

    const verify = event.target.closest("[data-purchase-action='verify']");
    if (verify) {
      const input = document.getElementById("paymentReference");
      const paymentReference = String(input?.value || "").trim();
      if (!paymentReference) {
        state.lastError = "Enter a Stripe PaymentIntent or Checkout Session reference.";
        return renderEvidence();
      }
      input.value = "";
      return execute("secure-purchase-verification", () => window.obserraOwner.verifyAcademyPurchase({
        courseId: course.id,
        paymentReference,
      }));
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.busy) refresh();
  });

  refresh();
})();
