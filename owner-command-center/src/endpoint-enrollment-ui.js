(() => {
  "use strict";

  const panel = document.getElementById("endpointEnrollmentPanel");
  if (!panel || !window.obserraOwner) return;

  const stateBadge = document.getElementById("endpointEnrollmentState");
  const summary = document.getElementById("endpointEnrollmentSummary");
  const details = document.getElementById("endpointEnrollmentDetails");
  const blockers = document.getElementById("endpointEnrollmentBlockers");
  const enrollButton = document.getElementById("endpointEnroll");
  const refreshButton = document.getElementById("endpointRefresh");
  const revokeButton = document.getElementById("endpointRevoke");

  let snapshot = null;
  let busy = false;

  function text(value, fallback = "Unavailable") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function setBusy(value) {
    busy = value;
    enrollButton.disabled = value;
    refreshButton.disabled = value;
    revokeButton.disabled = value;
  }

  function render() {
    const enrollmentState = snapshot?.enrollment?.state || "not-enrolled";
    const endpointReady = snapshot?.endpointReady === true;
    const enrolled = enrollmentState === "enrolled";

    stateBadge.textContent = endpointReady
      ? "Device ready"
      : enrolled
        ? "Enrolled · verification pending"
        : "Owner enrollment required";
    stateBadge.className = endpointReady ? "badge ok" : "badge warn";

    summary.textContent = endpointReady
      ? "This desktop is enrolled, heartbeat-current, and ready for local owner operations."
      : enrolled
        ? "The device identity is enrolled. Complete the listed readiness items before treating the endpoint as operational."
        : "This standard installer is not bound to one computer. Enroll the current desktop explicitly after installation.";

    const rows = [
      ["Device", snapshot?.hostname],
      ["Platform", snapshot?.platform],
      ["Application version", snapshot?.appVersion],
      ["Device ID", snapshot?.deviceId],
      ["Enrollment", enrollmentState],
      ["Bootstrap profile", snapshot?.bootstrap?.profileId],
      ["Bootstrap target", snapshot?.bootstrap?.targetHostname],
      ["Last heartbeat", snapshot?.lastHeartbeatAt ? new Date(snapshot.lastHeartbeatAt).toLocaleString() : null],
      ["Endpoint ready", endpointReady ? "Yes" : "No"],
      ["Control plane operational", snapshot?.controlPlaneOperational === true ? "Yes" : "No"]
    ];

    details.replaceChildren();
    for (const [label, value] of rows) {
      const item = document.createElement("div");
      item.className = "securitySummary";
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      item.append(strong, document.createTextNode(text(value)));
      details.append(item);
    }

    blockers.replaceChildren();
    const activeBlockers = Array.isArray(snapshot?.blockers) ? snapshot.blockers : [];
    if (activeBlockers.length === 0) {
      const clear = document.createElement("article");
      clear.className = "gapItem clear";
      clear.textContent = "No endpoint-readiness blockers are currently reported.";
      blockers.append(clear);
    } else {
      for (const blocker of activeBlockers) {
        const item = document.createElement("article");
        item.className = "gapItem high";
        item.textContent = text(blocker);
        blockers.append(item);
      }
    }

    enrollButton.hidden = enrolled;
    revokeButton.hidden = !enrolled;
  }

  async function refresh({ force = false } = {}) {
    if (busy) return;
    setBusy(true);
    stateBadge.textContent = "Checking device…";
    stateBadge.className = "badge";
    try {
      snapshot = force
        ? await window.obserraOwner.refreshEndpointSnapshot()
        : await window.obserraOwner.getEndpointSnapshot();
      render();
    } catch (error) {
      stateBadge.textContent = "Endpoint unavailable";
      stateBadge.className = "badge warn";
      summary.textContent = error instanceof Error ? error.message : String(error);
      details.replaceChildren();
      blockers.replaceChildren();
    } finally {
      setBusy(false);
    }
  }

  enrollButton.addEventListener("click", async () => {
    if (busy) return;
    const confirmation = window.prompt(
      "Type ENROLL THIS ENDPOINT to bind this installation to the current desktop."
    );
    if (confirmation === null) return;

    setBusy(true);
    try {
      await window.obserraOwner.enrollEndpoint({ confirmation });
      snapshot = await window.obserraOwner.refreshEndpointSnapshot();
      render();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  revokeButton.addEventListener("click", async () => {
    if (busy) return;
    const confirmation = window.prompt(
      "Type REVOKE THIS ENDPOINT to revoke this desktop identity."
    );
    if (confirmation === null) return;
    const reason = window.prompt("Reason for revocation", "owner-requested-revocation");
    if (reason === null) return;

    setBusy(true);
    try {
      await window.obserraOwner.revokeEndpoint({ confirmation, reason });
      snapshot = await window.obserraOwner.refreshEndpointSnapshot();
      render();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  refreshButton.addEventListener("click", () => void refresh({ force: true }));
  void refresh();
  window.setInterval(() => void refresh({ force: true }), 15000);
})();
