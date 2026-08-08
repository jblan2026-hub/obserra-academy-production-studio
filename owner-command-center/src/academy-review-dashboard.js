(() => {
  "use strict";

  const metrics = document.getElementById("academyReviewMetrics");
  const list = document.getElementById("academyReviewList");
  const search = document.getElementById("academyReviewSearch");
  const statusFilter = document.getElementById("academyReviewStatusFilter");
  const syncButton = document.getElementById("academyReviewSync");
  const refreshButton = document.getElementById("academyReviewRefresh");
  const sourceStatus = document.getElementById("academyReviewSourceStatus");
  const detail = document.getElementById("academyReviewDetail");
  const moduleList = document.getElementById("academyReviewModuleList");
  const media = document.getElementById("academyReviewMedia");
  const viewer = document.getElementById("academyReviewViewer");
  const decisionStatus = document.getElementById("academyReviewDecisionStatus");
  const note = document.getElementById("academyDecisionNote");
  const autoRelease = document.getElementById("academyAutoRelease");
  const queueRelease = document.getElementById("academyQueueRelease");
  const approveButton = document.getElementById("academyApprove");
  const reviseButton = document.getElementById("academyRevise");
  const rejectButton = document.getElementById("academyReject");
  const contentTabs = [...document.querySelectorAll("[data-academy-content-tab]")];

  let snapshot = null;
  let selectedCourseId = null;
  let selectedDetail = null;
  let selectedModuleId = null;
  let activeContentTab = "lesson";
  let busy = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function metric(label, value, detail, state = "neutral") {
    const card = node("article", "reviewMetric");
    card.dataset.state = state;
    card.append(
      node("span", "reviewMetricLabel", label),
      node("strong", "reviewMetricValue", value),
      node("small", "reviewMetricDetail", detail),
    );
    return card;
  }

  function formatDate(value) {
    if (!value) return "Unavailable";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  function decisionLabel(decision) {
    if (!decision) return "Pending owner review";
    return {
      approved: "Owner approved",
      "revision-requested": "Revision requested",
      rejected: "Owner rejected",
    }[decision.decision] || decision.decision;
  }

  function courseMatches(course) {
    const query = String(search.value || "").trim().toLowerCase();
    const haystack = [course.id, course.title, course.department, course.track, course.level]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query)) return false;
    const filter = statusFilter.value;
    if (filter === "pending") return !course.decision;
    if (filter === "content-ready") return course.readiness === "content-ready";
    if (filter === "blocked") return course.blockerCount > 0;
    if (filter === "approved") return course.decision?.decision === "approved";
    if (filter === "revision") return course.decision?.decision === "revision-requested";
    if (filter === "rejected") return course.decision?.decision === "rejected";
    return true;
  }

  function renderCourseItem(course) {
    const button = node("button", "academyReviewCourse");
    button.type = "button";
    button.dataset.courseId = course.id;
    button.dataset.state = course.blockerCount > 0
      ? "blocked"
      : course.decision?.decision === "approved"
        ? "approved"
        : "pending";
    button.classList.toggle("selected", course.id === selectedCourseId);

    const header = node("div", "academyReviewCourseHeader");
    const title = node("div", "academyReviewCourseTitle");
    title.append(
      node("strong", null, course.title),
      node("span", null, `${course.department || "Academy"} · ${course.level || "Professional"}`),
    );
    const state = node("span", "academyReviewCourseState", course.blockerCount > 0 ? `${course.blockerCount} blocker(s)` : decisionLabel(course.decision));
    header.append(title, state);

    const meta = node("div", "academyReviewCourseMeta");
    meta.append(
      node("span", null, `${course.moduleCount || 0} modules`),
      node("span", null, course.duration || "Duration unavailable"),
      node("span", null, course.authoringModel || "Authoring model unavailable"),
    );

    const progress = node("div", "academyReviewCourseProgress");
    const bar = node("span", null);
    const percent = course.blockerCount > 0 ? Math.max(10, 100 - course.blockerCount * 5) : 100;
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progress.append(bar);

    button.append(header, meta, progress);
    button.addEventListener("click", () => selectCourse(course.id));
    return button;
  }

  function renderList() {
    list.replaceChildren();
    const courses = (snapshot?.courses || []).filter(courseMatches);
    for (const course of courses) list.append(renderCourseItem(course));
    if (!courses.length) {
      list.append(node("div", "emptyState", snapshot?.available ? "No courses match the current review filter." : "Protected Academy review packages are not synchronized."));
    }
  }

  function selectedModule() {
    const modules = selectedDetail?.course?.learnerExperience?.modules || [];
    return modules.find((module) => module.id === selectedModuleId) || modules[0] || null;
  }

  function setTab(tab) {
    activeContentTab = tab;
    for (const button of contentTabs) {
      const active = button.dataset.academyContentTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    renderContentViewer();
  }

  function renderContentViewer() {
    const course = selectedDetail?.course;
    const module = selectedModule();
    viewer.replaceChildren();
    if (!course || !module) {
      viewer.append(node("div", "emptyState", "Select a course and module to review protected content."));
      return;
    }

    const heading = node("div", "reviewViewerHeading");
    heading.append(
      node("span", "eyebrow", `Module ${module.sequence || 1}`),
      node("h3", null, module.title || module.id),
      node("p", "subhead", `${module.duration || "Duration unavailable"} · ${module.format || "Format unavailable"}`),
    );
    viewer.append(heading);

    if (activeContentTab === "lesson") {
      const narrative = node("article", "reviewTextBlock");
      narrative.append(node("h4", null, "Lesson narrative"), node("p", null, module.lessonNarrative || "Lesson narrative is not available."));
      const concepts = node("article", "reviewTextBlock");
      concepts.append(node("h4", null, "Key concepts"));
      const conceptList = node("div", "reviewConceptGrid");
      for (const concept of module.keyConcepts || []) {
        const item = node("div", "reviewConcept");
        item.append(node("strong", null, concept.term || "Concept"), node("span", null, concept.explanation || "Explanation unavailable."));
        conceptList.append(item);
      }
      concepts.append(conceptList);
      viewer.append(narrative, concepts);
    } else if (activeContentTab === "slides") {
      const slideGrid = node("div", "reviewSlideGrid");
      for (const [index, slide] of (module.slideNarrative || []).entries()) {
        const card = node("article", "reviewSlide");
        card.append(
          node("span", "slideNumber", `Slide ${index + 1}`),
          node("h4", null, slide.title || "Untitled slide"),
          node("p", null, Array.isArray(slide.content) ? slide.content.join(" · ") : String(slide.content || "")),
          node("small", null, slide.speakerNotes || "Speaker notes unavailable."),
        );
        slideGrid.append(card);
      }
      if (!slideGrid.children.length) slideGrid.append(node("div", "emptyState", "Slide narrative is not available."));
      viewer.append(slideGrid);
    } else if (activeContentTab === "workbook") {
      const workbook = module.workbook || null;
      const block = node("article", "reviewTextBlock");
      block.append(node("h4", null, "Learner workbook"));
      if (!workbook) {
        block.append(node("p", null, "Workbook content is not available."));
      } else {
        block.append(node("h5", null, "Reflection prompts"));
        for (const prompt of workbook.reflectionPrompts || []) block.append(node("p", null, prompt));
        block.append(node("h5", null, "Decision worksheet"));
        for (const row of workbook.decisionWorksheet || []) block.append(node("pre", "reviewJson", typeof row === "string" ? row : JSON.stringify(row, null, 2)));
      }
      viewer.append(block);
    } else if (activeContentTab === "assessment") {
      const block = node("div", "reviewAssessmentList");
      const questions = (course.learnerExperience?.finalAssessment || []).filter((question) => question.moduleId === module.id);
      for (const [index, question] of questions.entries()) {
        const item = node("article", "reviewQuestion");
        item.append(node("strong", null, `${index + 1}. ${question.question || "Question unavailable"}`));
        const options = node("ol", null);
        for (const option of question.options || []) options.append(node("li", null, option));
        item.append(options, node("small", null, `Correct option ${Number(question.correctIndex || 0) + 1} · ${question.rationale || "Rationale unavailable"}`));
        block.append(item);
      }
      if (!questions.length) block.append(node("div", "emptyState", "No final-assessment questions are mapped to this module."));
      viewer.append(block);
    } else if (activeContentTab === "sources") {
      const block = node("div", "reviewSourceList");
      for (const source of course.learnerExperience?.sourceRegister || []) {
        const item = node("article", "reviewSource");
        item.append(
          node("strong", null, source.id || "Source placeholder"),
          node("span", null, source.claimOrTopic || "Topic unavailable"),
          node("small", null, source.verificationInstruction || "Verification instruction unavailable"),
        );
        block.append(item);
      }
      if (!block.children.length) block.append(node("div", "emptyState", "Source register is not available."));
      viewer.append(block);
    }
  }

  function renderMedia() {
    media.replaceChildren();
    const module = selectedModule();
    if (!module) {
      media.append(node("div", "emptyState", "Select a module to review its video and audio package."));
      return;
    }

    const assets = Array.isArray(module.renderedMedia) ? module.renderedMedia : [];
    const videoAssets = assets.filter((asset) => asset.type === "video");
    if (videoAssets.length > 0) {
      const video = document.createElement("video");
      video.className = "academyVideoPlayer";
      video.controls = true;
      video.preload = "metadata";
      video.src = videoAssets[0].url;
      const assetPicker = node("select", "academyMediaPicker");
      for (const asset of videoAssets) {
        const option = node("option", null, asset.name);
        option.value = asset.url;
        assetPicker.append(option);
      }
      assetPicker.addEventListener("change", () => {
        video.src = assetPicker.value;
        video.load();
      });
      media.append(
        node("div", "mediaState good", "Rendered course video available"),
        assetPicker,
        video,
      );
    } else {
      media.append(
        node("div", "mediaState warning", module.videoScript ? "Video script ready, rendered video not yet available" : "Video package missing"),
      );
      const script = node("article", "videoScriptPreview");
      const videoScript = module.videoScript || {};
      script.append(node("h4", null, "Video script preview"));
      if (videoScript.opening) script.append(node("p", null, videoScript.opening));
      for (const [index, segment] of (videoScript.segments || []).entries()) {
        const row = node("div", "videoScriptSegment");
        row.append(
          node("strong", null, `Segment ${index + 1}`),
          node("span", null, `Visual: ${segment.visual || "Not specified"}`),
          node("p", null, segment.narration || "Narration unavailable"),
        );
        script.append(row);
      }
      if (videoScript.closing) script.append(node("p", null, videoScript.closing));
      media.append(script);
    }
  }

  function renderModules() {
    moduleList.replaceChildren();
    const modules = selectedDetail?.course?.learnerExperience?.modules || [];
    if (!selectedModuleId && modules.length) selectedModuleId = modules[0].id;
    for (const module of modules) {
      const button = node("button", "academyModuleButton");
      button.type = "button";
      button.classList.toggle("active", module.id === selectedModuleId);
      button.dataset.state = module.videoReviewState === "rendered-media-available" ? "good" : module.videoReviewState === "script-only" ? "warning" : "critical";
      button.append(
        node("span", "academyModuleSequence", String(module.sequence || 1).padStart(2, "0")),
        node("span", "academyModuleTitle", module.title || module.id),
        node("small", null, module.videoReviewState === "rendered-media-available" ? "Video ready" : module.videoReviewState === "script-only" ? "Script only" : "Media missing"),
      );
      button.addEventListener("click", () => {
        selectedModuleId = module.id;
        renderModules();
        renderMedia();
        renderContentViewer();
      });
      moduleList.append(button);
    }
    if (!modules.length) moduleList.append(node("div", "emptyState", "No learner modules are available."));
  }

  function renderDetail() {
    detail.replaceChildren();
    if (!selectedDetail?.course) {
      detail.append(node("div", "emptyState", "Select a course from the review queue."));
      moduleList.replaceChildren();
      media.replaceChildren();
      viewer.replaceChildren();
      decisionStatus.textContent = "No course selected";
      approveButton.disabled = true;
      reviseButton.disabled = true;
      rejectButton.disabled = true;
      return;
    }

    const course = selectedDetail.course;
    const header = node("div", "academyDetailHeader");
    const copy = node("div", null);
    copy.append(
      node("span", "eyebrow", `${course.department || "Academy"} · ${course.track || "Professional"}`),
      node("h2", null, course.title),
      node("p", "subhead", course.description || "Description unavailable."),
    );
    const badge = node("span", "courseDecisionBadge", decisionLabel(selectedDetail.decision));
    badge.dataset.state = selectedDetail.decision?.decision || (selectedDetail.blockers.length ? "blocked" : "pending");
    header.append(copy, badge);

    const facts = node("div", "academyDetailFacts");
    const rows = [
      ["Course ID", course.id],
      ["Duration", course.duration],
      ["Level", course.level],
      ["Modules", course.moduleCount],
      ["Authoring model", course.authoring?.model || "Unavailable"],
      ["Generated", formatDate(course.authoring?.generatedAt)],
      ["Release status", course.releaseStatus],
      ["Publication", course.publication?.approved ? "Approved" : "Disabled"],
      ["Rendered media", selectedDetail.renderedMedia?.length || 0],
      ["Review blockers", selectedDetail.blockers.length],
    ];
    for (const [label, value] of rows) {
      const item = node("div", "academyDetailFact");
      item.append(node("span", null, label), node("strong", null, value ?? "Unavailable"));
      facts.append(item);
    }

    const blockers = node("div", "academyBlockerList");
    if (selectedDetail.blockers.length) {
      for (const blocker of selectedDetail.blockers) blockers.append(node("span", "academyBlocker", blocker));
    } else {
      blockers.append(node("span", "academyBlocker clear", "Protected content package passed structural owner-review checks."));
    }

    detail.append(header, facts, blockers);
    renderModules();
    renderMedia();
    renderContentViewer();

    note.value = selectedDetail.decision?.note || "";
    autoRelease.checked = selectedDetail.decision?.autoReleaseWhenEligible === true;
    queueRelease.checked = selectedDetail.decision?.queueProductionRelease === true;
    approveButton.disabled = busy || selectedDetail.blockers.length > 0;
    reviseButton.disabled = busy;
    rejectButton.disabled = busy;
    decisionStatus.textContent = selectedDetail.decision
      ? `${decisionLabel(selectedDetail.decision)} · ${formatDate(selectedDetail.decision.decidedAt)}${selectedDetail.decision.githubSubmission?.submitted ? " · submitted to GitHub" : selectedDetail.decision.githubSubmissionError ? ` · GitHub submission failed: ${selectedDetail.decision.githubSubmissionError}` : ""}`
      : selectedDetail.blockers.length
        ? `${selectedDetail.blockers.length} blocker(s) must be resolved before approval.`
        : "Course is ready for an owner content decision.";
    decisionStatus.dataset.state = selectedDetail.blockers.length ? "warning" : selectedDetail.decision?.decision === "approved" ? "good" : "neutral";
  }

  async function selectCourse(courseId) {
    if (busy) return;
    selectedCourseId = courseId;
    selectedModuleId = null;
    renderList();
    detail.replaceChildren(node("div", "loadingState", "Loading protected course package…"));
    try {
      selectedDetail = await window.obserraOwner.getAcademyReviewCourse(courseId);
      renderDetail();
    } catch (error) {
      selectedDetail = null;
      detail.replaceChildren(node("div", "errorState", error.message || String(error)));
    }
  }

  function renderSnapshot(next) {
    snapshot = next;
    const summary = next.summary || {};
    metrics.replaceChildren(
      metric("Protected courses", summary.total || 0, `Source: ${next.source || "unavailable"}`, summary.total > 0 ? "good" : "warning"),
      metric("Content ready", summary.contentReady || 0, `${summary.blocked || 0} blocked`, summary.blocked === 0 && summary.total > 0 ? "good" : "warning"),
      metric("Pending review", summary.pendingReview || 0, "Owner decision required", summary.pendingReview > 0 ? "active" : "good"),
      metric("Owner approved", summary.approved || 0, `${summary.publicationApproved || 0} publication approved`, summary.approved > 0 ? "good" : "neutral"),
      metric("Rendered media", "Per course", "Video player activates when mastered media exists", "neutral"),
      metric("Catalog schema", next.catalogSchemaVersion || "N/A", next.synchronizedAt ? `Synced ${formatDate(next.synchronizedAt)}` : "Not synchronized", next.available ? "good" : "warning"),
    );
    sourceStatus.textContent = next.available
      ? `${summary.total || 0} protected courses loaded from ${next.source}. ${summary.contentReady || 0} content-ready, ${summary.blocked || 0} blocked, ${summary.pendingReview || 0} awaiting owner review.`
      : (next.blockers || ["Protected Academy review data is unavailable."])[0];
    sourceStatus.dataset.state = next.available ? (summary.blocked > 0 ? "warning" : "good") : "critical";
    renderList();
    if (selectedCourseId && (next.courses || []).some((course) => course.id === selectedCourseId)) {
      selectCourse(selectedCourseId).catch(() => {});
    } else if ((next.courses || []).length) {
      selectCourse(next.courses[0].id).catch(() => {});
    } else {
      selectedCourseId = null;
      selectedDetail = null;
      renderDetail();
    }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing review queue…";
    try {
      renderSnapshot(await window.obserraOwner.getAcademyReviewSnapshot());
    } catch (error) {
      renderSnapshot({ available: false, courses: [], summary: {}, blockers: [error.message || String(error)] });
    } finally {
      busy = false;
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh review queue";
    }
  }

  async function synchronize() {
    if (busy) return;
    busy = true;
    syncButton.disabled = true;
    syncButton.textContent = "Synchronizing protected courses…";
    sourceStatus.textContent = "Downloading and verifying the latest protected Academy course artifact from GitHub.";
    sourceStatus.dataset.state = "working";
    try {
      renderSnapshot(await window.obserraOwner.synchronizeAcademyReview());
      window.obserraMission?.setCommandStatus("Protected Academy review packages synchronized.", "success");
    } catch (error) {
      sourceStatus.textContent = `Academy review synchronization failed: ${error.message || String(error)}`;
      sourceStatus.dataset.state = "critical";
      window.obserraMission?.setCommandStatus(sourceStatus.textContent, "error");
    } finally {
      busy = false;
      syncButton.disabled = false;
      syncButton.textContent = "Sync protected course packages";
    }
  }

  async function decide(decision) {
    if (!selectedCourseId || busy) return;
    const decisionNote = note.value.trim();
    if (decisionNote.length < 3) {
      window.alert("Enter an owner review note before recording a course decision.");
      return;
    }
    if (decision === "approved" && selectedDetail?.blockers?.length) {
      window.alert("Resolve all course review blockers before approval.");
      return;
    }
    const label = decision === "approved" ? "APPROVE" : decision === "revision-requested" ? "REQUEST REVISION" : "REJECT";
    const confirmation = window.prompt(`Type ${label} ${selectedCourseId} to record this owner decision.`);
    if (confirmation !== `${label} ${selectedCourseId}`) return;
    busy = true;
    approveButton.disabled = true;
    reviseButton.disabled = true;
    rejectButton.disabled = true;
    decisionStatus.textContent = "Recording device-bound owner course decision…";
    decisionStatus.dataset.state = "working";
    try {
      const record = await window.obserraOwner.recordAcademyCourseDecision({
        courseId: selectedCourseId,
        decision,
        note: decisionNote,
        autoReleaseWhenEligible: autoRelease.checked,
        queueProductionRelease: queueRelease.checked,
      });
      window.obserraMission?.setCommandStatus(
        record.githubSubmission?.submitted
          ? `${selectedCourseId} decision recorded and submitted to the governed GitHub release queue.`
          : `${selectedCourseId} decision recorded locally. ${record.githubSubmissionError || "GitHub submission is pending connector authorization."}`,
        record.githubSubmissionError ? "error" : "success",
      );
      await refresh();
      await selectCourse(selectedCourseId);
    } catch (error) {
      decisionStatus.textContent = `Decision failed: ${error.message || String(error)}`;
      decisionStatus.dataset.state = "critical";
    } finally {
      busy = false;
      renderDetail();
    }
  }

  search.addEventListener("input", renderList);
  statusFilter.addEventListener("change", renderList);
  syncButton.addEventListener("click", synchronize);
  refreshButton.addEventListener("click", refresh);
  approveButton.addEventListener("click", () => decide("approved"));
  reviseButton.addEventListener("click", () => decide("revision-requested"));
  rejectButton.addEventListener("click", () => decide("rejected"));
  for (const tab of contentTabs) tab.addEventListener("click", () => setTab(tab.dataset.academyContentTab));

  window.addEventListener("obserra:mission-snapshot", (event) => {
    if (event.detail?.academy) renderSnapshot(event.detail.academy);
  });
  setTab("lesson");
  refresh().catch(() => {});
})();
