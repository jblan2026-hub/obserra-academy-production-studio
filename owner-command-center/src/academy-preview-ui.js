const previewDialog = document.getElementById("academyPreviewDialog");
const previewTitle = document.getElementById("academyPreviewTitle");
const previewMeta = document.getElementById("academyPreviewMeta");
const previewBody = document.getElementById("academyPreviewBody");
const previewClose = document.getElementById("academyPreviewClose");
const academyCoursesContainer = document.getElementById("academyCourses");
let previewCourseIndex = new Map();
let reviewRefreshInFlight = false;
let hydrateTimer = null;

function notify(message, state = "info") {
  if (typeof window.obserraNotify === "function") {
    window.obserraNotify(message, state);
    return;
  }
  window.alert(message);
}

function formatPreview(value) {
  if (value === null || value === undefined || value === "") {
    return "Not generated or not available.";
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function openPreview(title, payload) {
  previewTitle.textContent = title;
  previewMeta.textContent = `${payload.courseId || "Academy"} · ${payload.source || payload.type || "preview"}`;
  previewBody.textContent = formatPreview(payload);
  previewDialog.showModal();
}

async function loadPreview(kind, courseId, title) {
  try {
    const operation = {
      course: window.obserraOwner.previewAcademyCourse,
      materials: window.obserraOwner.previewAcademyMaterials,
      certificate: window.obserraOwner.previewAcademyCertificate,
    }[kind];
    if (typeof operation !== "function") throw new Error("The requested Academy preview operation is unavailable.");
    const payload = await operation(courseId);
    const label = kind === "course"
      ? "Course preview"
      : kind === "materials"
        ? "Material preview"
        : "Certificate preview";
    openPreview(`${title} · ${label}`, payload);
  } catch (error) {
    notify(error.message || String(error), "error");
  }
}

async function reviseWithAI(courseId, title) {
  const approved = window.confirm(
    `Regenerate the governed AI-authored package for ${title}? The current generated package will be replaced and must pass review again.`,
  );
  if (!approved) return;
  try {
    const result = await window.obserraOwner.runAcademyAction({ action: "revise", courseId });
    if (!result.ok) {
      throw new Error(result.stderr || `AI revision failed with exit code ${result.exitCode}`);
    }
    notify(`AI revision completed for ${title}. Review the new course and materials before approval.`, "ok");
    document.getElementById("academyRefresh")?.click();
  } catch (error) {
    notify(error.message || String(error), "error");
  }
}

function metricCard(label, value, detail = "") {
  const card = document.createElement("div");
  card.className = "metric";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = String(value);
  card.append(labelNode, valueNode);
  if (detail) {
    const detailNode = document.createElement("small");
    detailNode.textContent = detail;
    card.append(detailNode);
  }
  return card;
}

function courseReviewStage(course) {
  if (course.publishToAcademy && ["approved", "published"].includes(course.releaseStatus)) {
    return { key: "published", label: "Published", severity: "clear" };
  }
  if (course.releaseStatus === "retired") {
    return { key: "retired", label: "Retired", severity: "medium" };
  }
  if (course.generation !== "generated") {
    return { key: "awaiting-generation", label: "Awaiting generated package", severity: "high" };
  }
  if ((course.missingArtifacts || []).length > 0) {
    return { key: "materials-incomplete", label: "Materials incomplete", severity: "high" };
  }
  if (Number(course.reviewCompletion || 0) < 100) {
    return { key: "review-pending", label: "Required reviews pending", severity: "high" };
  }
  if (!["approved", "published"].includes(course.releaseStatus)) {
    return { key: "owner-review-ready", label: "Ready for owner review", severity: "medium" };
  }
  return { key: "approved-not-published", label: "Approved, publication disabled", severity: "medium" };
}

function pendingForOwner(course) {
  const stage = courseReviewStage(course);
  return !["published", "retired"].includes(stage.key);
}

function materialInventory(course) {
  const rows = [
    {
      name: "Governed course package",
      present: course.generation === "generated",
    },
    ...(course.artifacts || []).map((artifact) => ({
      name: artifact.artifact,
      present: artifact.present === true,
    })),
    {
      name: "Certificate preview",
      present: true,
    },
    {
      name: "FINAL release record",
      present: course.finalRelease === true,
    },
  ];
  const unique = new Map();
  for (const row of rows) unique.set(row.name, row);
  return [...unique.values()];
}

function ensureReviewQueuePanel() {
  let panel = document.getElementById("academyReviewQueuePanel");
  if (panel) return panel;
  const academyPanel = document.querySelector(".academyPanel");
  if (!academyPanel?.parentNode) return null;

  panel = document.createElement("section");
  panel.className = "panel academyReviewQueuePanel";
  panel.id = "academyReviewQueuePanel";
  panel.innerHTML = `
    <div class="sectionTitle">
      <div>
        <p class="eyebrow">OWNER COURSE REVIEW INBOX</p>
        <h2>Pending courses and materials</h2>
        <p id="academyReviewQueueStatus" class="subhead">Loading the course-by-course review queue and material inventory…</p>
      </div>
      <button id="academyReviewQueueRefresh" class="secondary">Refresh review queue</button>
    </div>
    <section id="academyReviewQueueMetrics" class="grid metrics"></section>
    <div id="academyReviewQueue" class="gapList"></div>
  `;
  academyPanel.parentNode.insertBefore(panel, academyPanel);
  document.getElementById("academyReviewQueueRefresh")?.addEventListener("click", () => {
    void refreshAcademyReviewQueue({ force: true });
  });
  return panel;
}

function openCourseInOperations(course) {
  const search = document.getElementById("academySearch");
  const filter = document.getElementById("academyFilter");
  if (search) {
    search.value = course.title;
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (filter) {
    filter.value = "all";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  }
  window.setTimeout(() => {
    const card = document.querySelector(`.courseOpsCard[data-course-id="${CSS.escape(course.id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector("button")?.focus();
  }, 100);
}

function createReviewQueueItem(course) {
  const stage = courseReviewStage(course);
  const item = document.createElement("article");
  item.className = `gapItem ${stage.severity}`;
  item.dataset.courseId = course.id;

  const title = document.createElement("strong");
  title.textContent = `${course.title} · ${stage.label}`;

  const facts = document.createElement("span");
  facts.textContent = `${course.department} · ${course.level} · ${course.track} · release ${course.releaseStatus} · required reviews ${course.reviewCompletion}%`;

  const inventory = materialInventory(course);
  const readyMaterials = inventory.filter((material) => material.present).length;
  const materials = document.createElement("span");
  materials.textContent = `Materials: ${inventory.map((material) => `${material.present ? "✓" : "✕"} ${material.name}`).join(" · ")}`;

  const reviewEvidence = document.createElement("span");
  const reviewRows = (course.reviews || []).map((review) => `${review.name}: ${review.status}`);
  reviewEvidence.textContent = reviewRows.length
    ? `Review evidence: ${reviewRows.join(" · ")}`
    : "Review evidence: no required review records were returned.";

  const recommendation = document.createElement("em");
  recommendation.textContent = (course.recommendations || [])[0]
    || `${readyMaterials}/${inventory.length} material items are available for review.`;

  const actions = document.createElement("div");
  actions.className = "actions";
  const controls = [
    ["Review course", "secondary", () => loadPreview("course", course.id, course.title)],
    ["Review materials", "secondary", () => loadPreview("materials", course.id, course.title)],
    ["Review certificate", "secondary", () => loadPreview("certificate", course.id, course.title)],
    ["AI revise", "aiRevision", () => reviseWithAI(course.id, course.title)],
    ["Open production controls", "secondary", () => openCourseInOperations(course)],
  ];
  for (const [label, className, handler] of controls) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.append(button);
  }

  item.append(title, facts, materials, reviewEvidence, recommendation, actions);
  return item;
}

function renderReviewQueue(snapshot) {
  ensureReviewQueuePanel();
  const status = document.getElementById("academyReviewQueueStatus");
  const metrics = document.getElementById("academyReviewQueueMetrics");
  const queue = document.getElementById("academyReviewQueue");
  if (!status || !metrics || !queue) return;

  const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
  const pending = courses.filter(pendingForOwner);
  const reviewReady = pending.filter((course) => courseReviewStage(course).key === "owner-review-ready");
  const materialsIncomplete = pending.filter((course) => courseReviewStage(course).key === "materials-incomplete");
  const awaitingGeneration = pending.filter((course) => courseReviewStage(course).key === "awaiting-generation");

  metrics.replaceChildren(
    metricCard("Pending owner review", pending.length, "Course-by-course owner inbox"),
    metricCard("Ready for owner review", reviewReady.length, "Generated, materials present, reviews complete"),
    metricCard("Materials incomplete", materialsIncomplete.length),
    metricCard("Awaiting generation", awaitingGeneration.length),
    metricCard("Published", courses.filter((course) => course.publishToAcademy).length),
  );

  if (!snapshot?.available) {
    status.textContent = "Academy course content is not connected to this installed desktop. Connect or synchronize the governed Academy workspace before reviewing materials.";
    queue.replaceChildren();
    const blocker = document.createElement("article");
    blocker.className = "gapItem high";
    blocker.textContent = (snapshot?.gaps || ["Academy Studio workspace is unavailable."]).join(" ");
    queue.append(blocker);
    return;
  }

  status.textContent = `${pending.length} course${pending.length === 1 ? "" : "s"} remain in the owner review workflow. Each row exposes the course content, learner and instructor materials, assessment content, certificate preview, and production controls.`;
  queue.replaceChildren();

  const stagePriority = {
    "owner-review-ready": 0,
    "review-pending": 1,
    "materials-incomplete": 2,
    "awaiting-generation": 3,
    "approved-not-published": 4,
  };
  pending
    .slice()
    .sort((left, right) => {
      const leftStage = courseReviewStage(left).key;
      const rightStage = courseReviewStage(right).key;
      return (stagePriority[leftStage] ?? 9) - (stagePriority[rightStage] ?? 9)
        || left.title.localeCompare(right.title);
    })
    .forEach((course) => queue.append(createReviewQueueItem(course)));

  if (!pending.length) {
    const clear = document.createElement("article");
    clear.className = "gapItem clear";
    clear.textContent = "No Academy course is currently pending owner review.";
    queue.append(clear);
  }
}

function addPreviewControls(card, course) {
  if (card.dataset.previewControls === "ready") return;
  card.dataset.previewControls = "ready";
  card.dataset.courseId = course.id;
  const actions = card.querySelector(".courseActions");
  if (!actions) return;
  const controls = [
    ["Preview course", () => loadPreview("course", course.id, course.title)],
    ["Preview materials", () => loadPreview("materials", course.id, course.title)],
    ["Preview certificate", () => loadPreview("certificate", course.id, course.title)],
    ["AI revise", () => reviseWithAI(course.id, course.title)],
  ];
  for (const [label, handler] of controls) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = label === "AI revise" ? "aiRevision" : "secondary";
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.append(button);
  }
}

async function refreshAcademyReviewQueue({ force = false } = {}) {
  if (reviewRefreshInFlight && !force) return;
  reviewRefreshInFlight = true;
  try {
    const snapshot = await window.obserraOwner.getAcademySnapshot();
    previewCourseIndex = new Map((snapshot.courses || []).map((course) => [course.title, course]));
    document.querySelectorAll(".courseOpsCard").forEach((card) => {
      const title = card.querySelector(".courseTitle")?.textContent;
      const course = previewCourseIndex.get(title);
      if (course) addPreviewControls(card, course);
    });
    renderReviewQueue(snapshot);
  } catch (error) {
    renderReviewQueue({
      available: false,
      courses: [],
      gaps: [error.message || String(error)],
    });
  } finally {
    reviewRefreshInFlight = false;
  }
}

function scheduleHydration() {
  if (hydrateTimer) window.clearTimeout(hydrateTimer);
  hydrateTimer = window.setTimeout(() => {
    hydrateTimer = null;
    void refreshAcademyReviewQueue();
  }, 75);
}

ensureReviewQueuePanel();
const observer = new MutationObserver(scheduleHydration);
if (academyCoursesContainer) observer.observe(academyCoursesContainer, { childList: true });
previewClose.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
window.addEventListener("obserra:page-changed", (event) => {
  if (event.detail?.page === "academy") void refreshAcademyReviewQueue();
});
window.obserraAcademyPreview = {
  loadPreview,
  reviseWithAI,
  refreshReviewQueue: () => refreshAcademyReviewQueue({ force: true }),
};
void refreshAcademyReviewQueue();
