const crypto = require("node:crypto");
const { classifyResponse } = require("./threat-policy.cjs");

const STATE_KEY = "securityEnforcement.state";
const OVERRIDE_MAX_MINUTES = 60;

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;

function createSecurityEnforcement(store) {
  function load() {
    return store.get(STATE_KEY) || { schemaVersion: "1.0", alerts: [], recommendations: [], blocks: {}, overrides: [], history: [] };
  }
  function save(state) {
    state.alerts = state.alerts.slice(-5000);
    state.recommendations = state.recommendations.slice(-2000);
    state.overrides = state.overrides.slice(-1000);
    state.history = state.history.slice(-5000);
    store.set(STATE_KEY, state);
    return state;
  }
  function activeOverride(state, scope) {
    return state.overrides.find((item) => item.status === "active" && item.scope === scope && Date.parse(item.expiresAt) > Date.now());
  }
  function evaluateFinding(finding) {
    const state = load();
    const scope = finding.route ? `route:${finding.route}` : finding.package ? `dependency:${finding.package}` : `finding:${finding.type}`;
    const confidence = finding.knownBad ? 0.95 : finding.mappings?.length ? 0.8 : 0.5;
    const decision = classifyResponse({ severity: finding.severity, mappings: finding.mappings || [], confidence, authorized: Boolean(activeOverride(state, scope)), sensitiveScope: true });
    const alert = { id: id("alt"), scope, type: finding.type, severity: finding.severity, action: decision.action, mappings: finding.mappings || [], evidence: finding.evidence, createdAt: now(), status: "open" };
    state.alerts.push(alert);
    if (decision.recommend) state.recommendations.push({ id: id("rec"), alertId: alert.id, scope, severity: finding.severity, action: decision.action === "block" ? "contain-and-block" : "review-and-remediate", remediation: finding.remediation, mappings: finding.mappings || [], createdAt: now(), status: "open" });
    if (decision.action === "block") {
      state.blocks[scope] = { alertId: alert.id, scope, reason: "High-confidence known-bad condition mapped to MITRE ATT&CK or OWASP.", mappings: finding.mappings || [], blockedAt: now(), ownerOverrideAllowed: true };
      state.history.push({ id: id("hist"), type: "automatic-block", scope, alertId: alert.id, createdAt: now() });
    }
    save(state);
    return { scope, decision, alert, blocked: decision.action === "block" };
  }
  function evaluateScan(scan) {
    return { evaluatedAt: now(), results: (scan.findings || []).map(evaluateFinding), snapshot: getSnapshot() };
  }
  function assertAllowed(scope) {
    const state = load();
    if (activeOverride(state, scope)) return true;
    if (state.blocks[scope]) throw new Error(`Blocked known-bad scope. Owner override required: ${state.blocks[scope].reason}`);
    return true;
  }
  function ownerOverride(scope, reason, durationMinutes = 15) {
    if (!scope || !String(reason || "").trim()) throw new Error("Owner override requires an affected scope and explicit reason");
    const state = load();
    if (!state.blocks[scope]) throw new Error("No active automatic block exists for this scope");
    const minutes = Math.max(1, Math.min(Number(durationMinutes) || 15, OVERRIDE_MAX_MINUTES));
    const override = { id: id("ovr"), scope, reason: String(reason).slice(0, 4000), createdBy: "owner", createdAt: now(), expiresAt: new Date(Date.now() + minutes * 60 * 1000).toISOString(), status: "active", blockEvidence: state.blocks[scope] };
    state.overrides.push(override);
    state.history.push({ id: id("hist"), type: "owner-override", scope, overrideId: override.id, createdAt: now(), expiresAt: override.expiresAt, reason: override.reason });
    save(state);
    return override;
  }
  function releaseOverride(idValue) {
    const state = load();
    const override = state.overrides.find((item) => item.id === idValue);
    if (!override) throw new Error("Override not found");
    override.status = "released";
    override.releasedAt = now();
    state.history.push({ id: id("hist"), type: "override-released", scope: override.scope, overrideId: override.id, createdAt: now() });
    save(state);
    return override;
  }
  function getSnapshot() {
    const state = load();
    return {
      schemaVersion: state.schemaVersion,
      alertCount: state.alerts.filter((item) => item.status === "open").length,
      recommendationCount: state.recommendations.filter((item) => item.status === "open").length,
      blockCount: Object.keys(state.blocks).length,
      activeOverrideCount: state.overrides.filter((item) => item.status === "active" && Date.parse(item.expiresAt) > Date.now()).length,
      alerts: state.alerts.slice(-200).reverse(),
      recommendations: state.recommendations.slice(-200).reverse(),
      blocks: state.blocks,
      overrides: state.overrides.slice(-100).reverse(),
      history: state.history.slice(-200).reverse()
    };
  }
  return { evaluateFinding, evaluateScan, assertAllowed, ownerOverride, releaseOverride, getSnapshot };
}

module.exports = { createSecurityEnforcement };
