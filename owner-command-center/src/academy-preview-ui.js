const previewDialog = document.getElementById("academyPreviewDialog");
const previewTitle = document.getElementById("academyPreviewTitle");
const previewMeta = document.getElementById("academyPreviewMeta");
const previewBody = document.getElementById("academyPreviewBody");
const previewClose = document.getElementById("academyPreviewClose");
let previewCourseIndex = new Map();

function formatPreview(value) {
  if (value === null || value === undefined || value === "") return "Not generated or not available.";
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
      certificate: window.obserraOwner.previewAcademyCertificate
    }[kind];
    const payload = await operation(courseId);
    openPreview(`${title} · ${kind === "course" ? "Course preview" : kind === "materials" ? "Material preview" : "Certificate preview"}`, payload);
  } catch (error) {
    window.alert(error.message || String(error));
  }
}

async function reviseWithAI(courseId, title) {
  const approved = window.confirm(`Regenerate the governed AI-authored package for ${title}? The current generated package will be replaced and must pass review again.`);
  if (!approved) return;
  try {
    const result = await window.obserraOwner.runAcademyAction({ action: "revise", courseId });
    if (!result.ok) throw new Error(result.stderr || `AI revision failed with exit code ${result.exitCode}`);
    window.alert(`AI revision completed for ${title}. Review the new course and materials before approval.`);
    document.getElementById("academyRefresh").click();
  } catch (error) {
    window.alert(error.message || String(error));
  }
}

function addPreviewControls(card, course) {
  if (card.dataset.previewControls === "ready") return;
  card.dataset.previewControls = "ready";
  card.dataset.courseId = course.id;
  const actions = card.querySelector(".courseActions");
  const controls = [
    ["Preview course", () => loadPreview("course", course.id, course.title)],
    ["Preview materials", () => loadPreview("materials", course.id, course.title)],
    ["Preview certificate", () => loadPreview("certificate", course.id, course.title)],
    ["AI revise", () => reviseWithAI(course.id, course.title)]
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

async function hydratePreviewControls() {
  try {
    const snapshot = await window.obserraOwner.getAcademySnapshot();
    previewCourseIndex = new Map((snapshot.courses || []).map((course) => [course.title, course]));
    document.querySelectorAll(".courseOpsCard").forEach((card) => {
      const title = card.querySelector(".courseTitle")?.textContent;
      const course = previewCourseIndex.get(title);
      if (course) addPreviewControls(card, course);
    });
  } catch {
    // The primary Academy workspace renders the unavailable state.
  }
}

const observer = new MutationObserver(() => hydratePreviewControls());
observer.observe(document.getElementById("academyCourses"), { childList: true });
previewClose.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
hydratePreviewControls();
