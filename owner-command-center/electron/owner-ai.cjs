const crypto = require("node:crypto");

const STATE_KEY = "ownerAi.state";
const MAX_EVENTS = 5000;
const MAX_RECOMMENDATIONS = 1000;
const MAX_MEMORIES = 2500;
const AUTHORIZED_WINDOW_MS = 5 * 60 * 1000;
const SENSITIVE_PREFIXES = ["academy:", "catalog:", "deployment:", "identity:", "network:", "service-manifest:"];

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function redactKey(key) {
  return /(secret|token|password|authorization|api[-_]?key|private[-_]?key|cookie)/i.test(key);
}

function sanitize(value, depth = 0) {
  if (depth > 8) return "[depth-limited]";
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string" && value.length > 12000) return `${value.slice(0, 12000)}...[truncated]`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().slice(0, 1000).map((key) => [key, redactKey(key) ? "[redacted]" : sanitize(value[key], depth + 1)]));
  }
  return String(value);
}

function stableJson(value) {
  return JSON.stringify(sanitize(value));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function defaultState() {
  return {
    schemaVersion: "1.0",
    startedAt: nowIso(),
    lastAnalyzedAt: null,
    cycleCount: 0,
    baselines: {},
    authorizedChanges: {},
    events: [],
    memories: [],
    recommendations: [],
    approvals: [],
    blockedScopes: {},
    sourceHealth: {},
    model: {
      mode: "deterministic-with-optional-local-model",
      localModel: process.env.OBSERRA_LOCAL_AI_MODEL || "llama3.2",
      lastEnrichmentAt: null,
      lastEnrichmentStatus: "not-run"
    }
  };
}

function loadState(store) {
  const state = store.get(STATE_KEY);
  if (!state || state.schemaVersion !== "1.0") {
    const initial = defaultState();
    store.set(STATE_KEY, initial);
    return initial;
  }
  return state;
}

function saveState(store, state) {
  state.events = state.events.slice(-MAX_EVENTS);
  state.memories = state.memories.slice(-MAX_MEMORIES);
  state.recommendations = state.recommendations.slice(-MAX_RECOMMENDATIONS);
  store.set(STATE_KEY, state);
  return state;
}

function severityRank(value) {
  return ({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })[value] ?? 0;
}

function scopeIsSensitive(scope) {
  return SENSITIVE_PREFIXES.some((prefix) => scope.startsWith(prefix));
}

function deriveSeverity(scope, payload) {
  const text = stableJson(payload).toLowerCase();
  if (/(failed|unavailable|critical|secret|unauthorized|configuration-required|identity.*degraded)/.test(text)) return "critical";
  if (/(degraded|not-generated|missing|unpublished|drift|changed|external)/.test(text)) return "high";
  if (scope.startsWith("network:") || scope.startsWith("deployment:")) return "high";
  if (scope.startsWith("academy:") || scope.startsWith("catalog:")) return "medium";
  return "low";
}

function recommendationFor(scope, severity, payload, eventId) {
  const source = scope.split(":")[0];
  const templates = {
    connector: "Investigate the service health, credentials, and deployment before enabling owner-control actions.",
    academy: "Review the course change, generation evidence, required artifacts, and publication status before release.",
    catalog: "Validate the synchronized catalog fingerprint and approve the change before website publication.",
    deployment: "Compare the new deployment commit, build evidence, runtime health, and rollback candidate before promotion.",
    identity: "Restore production identity configuration and verify protected learner flows before accepting payments or issuing credentials.",
    network: "Confirm the network or approved-service change is expected before restoring write-capable operations.",
    intelligence: "Review the reporting AI source and corroborate its recommendation against primary evidence."
  };
  return {
    id: newId("rec"),
    eventId,
    scope,
    severity,
    status: "open",
    title: `${source.toUpperCase()} change requires owner attention`,
    recommendation: templates[source] || "Review the observed change and supporting evidence before taking action.",
    evidenceFingerprint: fingerprint(payload),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function createOwnerAI(store) {
  function remember(text, source = "owner", tags = []) {
    if (typeof text !== "string" || !text.trim()) throw new Error("Memory text is required");
    const state = loadState(store);
    const memory = {
      id: newId("mem"),
      source,
      text: text.trim().slice(0, 16000),
      tags: Array.isArray(tags) ? tags.slice(0, 20).map(String) : [],
      fingerprint: fingerprint(text.trim()),
      createdAt: nowIso()
    };
    const duplicate = state.memories.find((item) => item.fingerprint === memory.fingerprint);
    if (!duplicate) state.memories.push(memory);
    saveState(store, state);
    return duplicate || memory;
  }

  function authorizeChange(scope, details = {}) {
    if (typeof scope !== "string" || !scope) throw new Error("Authorized change scope is required");
    const state = loadState(store);
    state.authorizedChanges[scope] = {
      authorizedAt: nowIso(),
      expiresAt: new Date(Date.now() + AUTHORIZED_WINDOW_MS).toISOString(),
      details: sanitize(details)
    };
    saveState(store, state);
  }

  function isRecentlyAuthorized(state, scope) {
    const direct = state.authorizedChanges[scope];
    const wildcard = state.authorizedChanges[`${scope.split(":")[0]}:*`];
    const candidate = direct || wildcard;
    return Boolean(candidate && Date.parse(candidate.expiresAt) > Date.now());
  }

  function observe(scope, payload, options = {}) {
    if (typeof scope !== "string" || !scope) throw new Error("Observation scope is required");
    const state = loadState(store);
    const sanitizedPayload = sanitize(payload);
    const nextHash = fingerprint(sanitizedPayload);
    const previous = state.baselines[scope];
    const observedAt = nowIso();
    state.sourceHealth[scope] = { observedAt, fingerprint: nextHash };

    if (!previous) {
      state.baselines[scope] = { fingerprint: nextHash, payload: sanitizedPayload, observedAt };
      state.events.push({ id: newId("evt"), scope, type: "baseline", severity: "info", payload: sanitizedPayload, fingerprint: nextHash, observedAt });
      saveState(store, state);
      return { changed: false, baselineCreated: true, fingerprint: nextHash };
    }

    if (previous.fingerprint === nextHash) {
      previous.observedAt = observedAt;
      saveState(store, state);
      return { changed: false, baselineCreated: false, fingerprint: nextHash };
    }

    const severity = options.severity || deriveSeverity(scope, sanitizedPayload);
    const event = {
      id: newId("evt"),
      scope,
      type: options.type || "drift",
      severity,
      origin: options.origin || "continuous-monitor",
      previousFingerprint: previous.fingerprint,
      fingerprint: nextHash,
      previousPayload: previous.payload,
      payload: sanitizedPayload,
      observedAt
    };
    state.events.push(event);
    state.baselines[scope] = { fingerprint: nextHash, payload: sanitizedPayload, observedAt };

    const authorized = options.authorized === true || isRecentlyAuthorized(state, scope);
    const requiresApproval = options.requiresApproval !== false && scopeIsSensitive(scope) && !authorized;
    const recommendation = recommendationFor(scope, severity, sanitizedPayload, event.id);
    state.recommendations.push(recommendation);

    if (requiresApproval) {
      const existing = state.approvals.find((item) => item.scope === scope && item.status === "pending");
      if (!existing) {
        const approval = {
          id: newId("apr"),
          eventId: event.id,
          recommendationId: recommendation.id,
          scope,
          severity,
          status: "pending",
          summary: `${scope} changed outside a recent Command Center-authorized operation.`,
          previousFingerprint: previous.fingerprint,
          fingerprint: nextHash,
          createdAt: observedAt,
          decidedAt: null,
          decidedBy: null,
          decisionNote: null
        };
        state.approvals.push(approval);
        state.blockedScopes[scope] = { approvalId: approval.id, blockedAt: observedAt, reason: approval.summary };
      }
    }

    saveState(store, state);
    return { changed: true, event, recommendation, requiresApproval, fingerprint: nextHash };
  }

  function analyzeCycle(input) {
    const state = loadState(store);
    state.cycleCount += 1;
    state.lastAnalyzedAt = nowIso();
    saveState(store, state);

    const outcomes = [];
    for (const connector of input.connectors || []) {
      outcomes.push(observe(`connector:${connector.id}`, {
        id: connector.id,
        status: connector.status,
        httpStatus: connector.httpStatus || null,
        controlEnabled: connector.controlEnabled === true,
        credentialConfigured: connector.credentialConfigured === true,
        error: connector.error || null,
        intelligence: connector.intelligence || null
      }, { requiresApproval: false, severity: connector.status === "failed" ? "critical" : connector.status === "degraded" ? "high" : "low" }));
    }

    if (input.network) outcomes.push(observe("network:approved-service-topology", input.network));
    if (input.serviceManifest) outcomes.push(observe("service-manifest:obserra", input.serviceManifest));
    if (input.deployment) outcomes.push(observe("deployment:integrated-services", input.deployment));
    if (input.identity) outcomes.push(observe("identity:academy", input.identity));

    if (input.academy) {
      outcomes.push(observe("catalog:academy", {
        available: input.academy.available,
        summary: input.academy.summary,
        gaps: input.academy.gaps,
        courseFingerprints: (input.academy.courses || []).map((course) => ({
          id: course.id,
          title: course.title,
          duration: course.duration,
          price: course.price,
          releaseStatus: course.releaseStatus,
          publishToAcademy: course.publishToAcademy,
          generation: course.generation,
          finalRelease: course.finalRelease,
          reviewCompletion: course.reviewCompletion,
          missingArtifacts: course.missingArtifacts
        }))
      }));
      for (const course of input.academy.courses || []) {
        outcomes.push(observe(`academy:${course.id}`, course));
      }
    }

    for (const report of input.intelligenceReports || []) {
      outcomes.push(observe(`intelligence:${report.sourceId || "unknown"}`, report, { requiresApproval: false }));
      if (report.memory) remember(report.memory, `ai:${report.sourceId || "unknown"}`, ["federated-ai"]);
    }

    return { analyzedAt: nowIso(), outcomes, snapshot: getSnapshot() };
  }

  function decideApproval(id, decision, note = "") {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Decision must be approved or rejected");
    const state = loadState(store);
    const approval = state.approvals.find((item) => item.id === id);
    if (!approval) throw new Error("Approval request not found");
    if (approval.status !== "pending") return approval;
    approval.status = decision;
    approval.decidedAt = nowIso();
    approval.decidedBy = "owner";
    approval.decisionNote = String(note || "").slice(0, 4000);
    if (decision === "approved") {
      delete state.blockedScopes[approval.scope];
      const recommendation = state.recommendations.find((item) => item.id === approval.recommendationId);
      if (recommendation) {
        recommendation.status = "accepted";
        recommendation.updatedAt = nowIso();
      }
      remember(`Approved observed change for ${approval.scope}. ${approval.decisionNote}`.trim(), "owner-approval", ["approval", approval.scope]);
    } else {
      state.blockedScopes[approval.scope] = { approvalId: approval.id, blockedAt: approval.createdAt, reason: "Owner rejected the observed change." };
      const recommendation = state.recommendations.find((item) => item.id === approval.recommendationId);
      if (recommendation) {
        recommendation.status = "rejected-change";
        recommendation.updatedAt = nowIso();
      }
      remember(`Rejected observed change for ${approval.scope}. ${approval.decisionNote}`.trim(), "owner-approval", ["rejection", approval.scope]);
    }
    saveState(store, state);
    return approval;
  }

  function acknowledgeRecommendation(id) {
    const state = loadState(store);
    const recommendation = state.recommendations.find((item) => item.id === id);
    if (!recommendation) throw new Error("Recommendation not found");
    recommendation.status = "acknowledged";
    recommendation.updatedAt = nowIso();
    saveState(store, state);
    return recommendation;
  }

  function assertScopeWritable(scope) {
    const state = loadState(store);
    const exact = state.blockedScopes[scope];
    const wildcard = state.blockedScopes[`${scope.split(":")[0]}:*`];
    const block = exact || wildcard;
    if (block) throw new Error(`Owner approval required before this operation can continue: ${block.reason}`);
    return true;
  }

  function getSnapshot() {
    const state = loadState(store);
    const openRecommendations = state.recommendations.filter((item) => ["open", "rejected-change"].includes(item.status)).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt.localeCompare(a.createdAt));
    const pendingApprovals = state.approvals.filter((item) => item.status === "pending").sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt.localeCompare(a.createdAt));
    return {
      schemaVersion: state.schemaVersion,
      status: "live",
      startedAt: state.startedAt,
      lastAnalyzedAt: state.lastAnalyzedAt,
      cycleCount: state.cycleCount,
      memoryCount: state.memories.length,
      eventCount: state.events.length,
      recommendationCount: openRecommendations.length,
      pendingApprovalCount: pendingApprovals.length,
      blockedScopeCount: Object.keys(state.blockedScopes).length,
      recommendations: openRecommendations.slice(0, 100),
      approvals: pendingApprovals.slice(0, 100),
      recentEvents: state.events.slice(-100).reverse(),
      recentMemories: state.memories.slice(-100).reverse(),
      blockedScopes: state.blockedScopes,
      sourceHealth: state.sourceHealth,
      model: state.model
    };
  }

  return { remember, authorizeChange, observe, analyzeCycle, decideApproval, acknowledgeRecommendation, assertScopeWritable, getSnapshot };
}

module.exports = { createOwnerAI, fingerprint, sanitize };
