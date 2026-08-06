const crypto = require("node:crypto");

const STATE_KEY = "trendStore.state";
const MAX_POINTS_PER_SERIES = 10000;
const MAX_SERIES = 1000;

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;

function numericSummary(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function createTrendStore(store) {
  function load() {
    return store.get(STATE_KEY) || { schemaVersion: "1.0", series: {}, snapshots: [], comparisons: [] };
  }

  function save(state) {
    const keys = Object.keys(state.series);
    if (keys.length > MAX_SERIES) {
      for (const key of keys.slice(0, keys.length - MAX_SERIES)) delete state.series[key];
    }
    for (const key of Object.keys(state.series)) state.series[key] = state.series[key].slice(-MAX_POINTS_PER_SERIES);
    state.snapshots = state.snapshots.slice(-5000);
    state.comparisons = state.comparisons.slice(-5000);
    store.set(STATE_KEY, state);
    return state;
  }

  function appendPoint(state, seriesId, value, metadata = {}) {
    if (!seriesId) throw new Error("Trend series id is required");
    state.series[seriesId] ||= [];
    const point = { id: id("pt"), seriesId, value, numericValue: numericSummary(value), metadata, recordedAt: now() };
    state.series[seriesId].push(point);
    return point;
  }

  function record(seriesId, value, metadata = {}) {
    const state = load();
    const point = appendPoint(state, seriesId, value, metadata);
    save(state);
    return point;
  }

  function recordSnapshot(domain, payload, metrics = {}) {
    const state = load();
    const snapshot = { id: id("snap"), domain, payload, metrics, recordedAt: now() };
    state.snapshots.push(snapshot);
    for (const [name, value] of Object.entries(metrics)) appendPoint(state, `${domain}:${name}`, value, { snapshotId: snapshot.id });
    save(state);
    return snapshot;
  }

  function compareSeries(seriesId, windowSize = 2) {
    const state = load();
    const points = state.series[seriesId] || [];
    const selected = points.slice(-Math.max(2, windowSize));
    if (selected.length < 2) return { seriesId, available: false, reason: "insufficient-history" };
    const first = selected[0];
    const last = selected[selected.length - 1];
    const numeric = selected.filter((point) => point.numericValue !== null);
    const delta = first.numericValue !== null && last.numericValue !== null ? last.numericValue - first.numericValue : null;
    const percentChange = delta !== null && first.numericValue !== 0 ? (delta / Math.abs(first.numericValue)) * 100 : null;
    const average = numeric.length ? numeric.reduce((sum, point) => sum + point.numericValue, 0) / numeric.length : null;
    const min = numeric.length ? Math.min(...numeric.map((point) => point.numericValue)) : null;
    const max = numeric.length ? Math.max(...numeric.map((point) => point.numericValue)) : null;
    return { seriesId, available: true, first, last, count: selected.length, delta, percentChange, average, min, max, direction: delta === null ? "changed" : delta > 0 ? "increasing" : delta < 0 ? "decreasing" : "stable" };
  }

  function compareSnapshots(domain) {
    const state = load();
    const items = state.snapshots.filter((item) => item.domain === domain).slice(-2);
    if (items.length < 2) return { domain, available: false, reason: "insufficient-history" };
    const [previous, current] = items;
    const metricNames = [...new Set([...Object.keys(previous.metrics || {}), ...Object.keys(current.metrics || {})])];
    const metrics = Object.fromEntries(metricNames.map((name) => {
      const before = previous.metrics?.[name] ?? null;
      const after = current.metrics?.[name] ?? null;
      const delta = typeof before === "number" && typeof after === "number" ? after - before : null;
      return [name, { before, after, delta, direction: delta === null ? "changed" : delta > 0 ? "increasing" : delta < 0 ? "decreasing" : "stable" }];
    }));
    const comparison = { id: id("cmp"), domain, previousSnapshotId: previous.id, currentSnapshotId: current.id, previousAt: previous.recordedAt, currentAt: current.recordedAt, metrics, createdAt: now() };
    state.comparisons.push(comparison);
    save(state);
    return { domain, available: true, previous, current, metrics };
  }

  function getDomainHistory(domain, limit = 100) {
    const state = load();
    return state.snapshots.filter((item) => item.domain === domain).slice(-Math.max(1, Math.min(limit, 1000))).reverse();
  }

  function getDashboard() {
    const state = load();
    const series = {};
    for (const key of Object.keys(state.series)) {
      const points = state.series[key];
      const selected = points.slice(-Math.min(30, points.length));
      if (selected.length < 2) series[key] = { seriesId: key, available: false, reason: "insufficient-history" };
      else {
        const first = selected[0];
        const last = selected[selected.length - 1];
        const delta = first.numericValue !== null && last.numericValue !== null ? last.numericValue - first.numericValue : null;
        series[key] = { seriesId: key, available: true, first, last, count: selected.length, delta, direction: delta === null ? "changed" : delta > 0 ? "increasing" : delta < 0 ? "decreasing" : "stable" };
      }
    }
    const domains = [...new Set(state.snapshots.map((item) => item.domain))];
    return { schemaVersion: state.schemaVersion, seriesCount: Object.keys(state.series).length, snapshotCount: state.snapshots.length, domains, series, latestSnapshots: state.snapshots.slice(-200).reverse(), latestComparisons: state.comparisons.slice(-200).reverse() };
  }

  return { record, recordSnapshot, compareSeries, compareSnapshots, getDomainHistory, getDashboard };
}

module.exports = { createTrendStore };
