(() => {
  "use strict";

  const pageButtons = [...document.querySelectorAll("[data-page-target]")];
  const pages = [...document.querySelectorAll(".appPage[data-page]")];
  const pageIds = new Set(pages.map((page) => page.dataset.page));
  const dynamicAssignments = {
    endpointLivePanel: "devices",
    academyProductionEvidencePanel: "academy",
    academyOwnerReleasePanel: "academy",
  };

  function normalizePage(value) {
    const candidate = String(value || "").replace(/^#/, "").trim();
    return pageIds.has(candidate) ? candidate : "overview";
  }

  function moveDynamicPanels() {
    for (const [id, pageId] of Object.entries(dynamicAssignments)) {
      const panel = document.getElementById(id);
      const target = document.querySelector(`.appPage[data-page="${pageId}"]`);
      if (panel && target && panel.parentElement !== target) target.append(panel);
      if (panel) panel.dataset.pagePanel = pageId;
    }
  }

  function activate(pageId, { updateHash = true } = {}) {
    const selected = normalizePage(pageId);
    for (const page of pages) {
      const active = page.dataset.page === selected;
      page.hidden = !active;
      page.setAttribute("aria-hidden", active ? "false" : "true");
    }
    for (const button of pageButtons) {
      const active = button.dataset.pageTarget === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    }
    document.body.dataset.activePage = selected;
    if (updateHash && window.location.hash !== `#${selected}`) {
      history.replaceState(null, "", `#${selected}`);
    }
    const heading = document.querySelector(`.appPage[data-page="${selected}"] .pageTitle`);
    document.title = heading
      ? `${heading.textContent} · Obserra Owner AI Command Center`
      : "Obserra Owner AI Command Center";
    window.scrollTo({ top: 0, behavior: "instant" });
    window.dispatchEvent(new CustomEvent("obserra:page-changed", { detail: { page: selected } }));
  }

  for (const button of pageButtons) {
    button.addEventListener("click", () => activate(button.dataset.pageTarget));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = pageButtons.indexOf(button);
      let nextIndex = currentIndex;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + pageButtons.length) % pageButtons.length;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % pageButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = pageButtons.length - 1;
      pageButtons[nextIndex].focus();
      activate(pageButtons[nextIndex].dataset.pageTarget);
    });
  }

  window.addEventListener("hashchange", () => activate(window.location.hash, { updateHash: false }));
  const observer = new MutationObserver(moveDynamicPanels);
  observer.observe(document.body, { childList: true, subtree: true });
  moveDynamicPanels();
  activate(window.location.hash || "overview", { updateHash: true });
})();
