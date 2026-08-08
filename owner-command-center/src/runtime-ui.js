(() => {
  "use strict";

  const region = document.getElementById("runtimeNotifications");
  const runtimeBadge = document.getElementById("runtimeBadge");

  function notify(message, state = "info", timeoutMs = 9000) {
    if (!region) return;
    const item = document.createElement("div");
    item.className = `runtimeNotice ${state}`;
    item.setAttribute("role", state === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = String(message || "Unknown Command Center event");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "noticeClose";
    close.textContent = "Dismiss";
    close.addEventListener("click", () => item.remove());
    item.append(text, close);
    region.prepend(item);
    while (region.children.length > 6) region.lastElementChild?.remove();
    if (timeoutMs > 0) window.setTimeout(() => item.remove(), timeoutMs);
  }

  function errorMessage(error) {
    if (error instanceof Error) return error.message || error.name;
    if (error?.reason instanceof Error) return error.reason.message;
    return String(error?.reason || error?.message || error || "Unknown error");
  }

  window.obserraNotify = notify;
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    notify(`Operation failed: ${errorMessage(event)}`, "error", 15000);
  });
  window.addEventListener("error", (event) => {
    notify(`Dashboard error: ${errorMessage(event.error || event.message)}`, "error", 15000);
  });

  if (!window.obserraOwner) {
    runtimeBadge.textContent = "Command bridge unavailable";
    runtimeBadge.className = "badge warn";
    notify("The secure Electron command bridge did not load. Reinstall the current verified package.", "error", 0);
    return;
  }

  runtimeBadge.textContent = "Command bridge ready";
  runtimeBadge.className = "badge ok";
})();
