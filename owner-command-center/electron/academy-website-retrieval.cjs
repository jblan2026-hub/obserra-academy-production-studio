"use strict";

const { resolvedConnectors } = require("./connectors.cjs");
const { ownerSafe, ownerSafeError, maskReference } = require("./academy-data-protection.cjs");

const COURSE_ID = /^[a-z0-9][a-z0-9-]{2,159}$/;
const CERTIFICATE_ID = /^OBS-[A-Z0-9]{6,150}-[0-9A-F]{8}$/;
const COURSE_VERSION = /^\d+\.\d+\.\d+$/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 512 * 1024;

function createAcademyWebsiteRetrieval({ store, safeStorage } = {}) {
  if (!store || !safeStorage) throw new Error("Academy website retrieval dependencies are required.");

  function websiteConnector() {
    const connector = resolvedConnectors(store).find((item) => item.id === "website");
    if (!connector) throw new Error("Website connector is not registered.");
    const parsed = new URL(connector.url);
    if (parsed.protocol !== "https:") throw new Error("Academy website retrieval requires HTTPS.");
    return connector;
  }

  function readOptionalSecret(key) {
    if (!key) return null;
    const encrypted = store.get(`secrets.${key}`);
    if (typeof encrypted !== "string" || !encrypted) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is required to use website credentials.");
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim() || null;
    } catch {
      return null;
    }
  }

  async function getJson(pathname, { authenticated = false } = {}) {
    const connector = websiteConnector();
    const url = new URL(pathname, `${connector.url}/`);
    if (url.origin !== new URL(connector.url).origin || url.protocol !== "https:") {
      throw new Error("Website retrieval path escaped the approved HTTPS origin.");
    }

    const headers = { Accept: "application/json" };
    if (authenticated) {
      const secret = readOptionalSecret(connector.credentialKey);
      if (secret) headers.Authorization = `Bearer ${secret}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("Website response exceeded the Academy retrieval size limit.");
      }
      let body = null;
      if (text) {
        try { body = JSON.parse(text); }
        catch { throw new Error("Website Academy endpoint returned a non-JSON response."); }
      }
      return {
        ok: response.ok,
        status: response.status,
        requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || null,
        verification: response.headers.get("x-obserra-certificate-verification") || null,
        body,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Website Academy retrieval timed out.");
      throw new Error(ownerSafeError(error));
    } finally {
      clearTimeout(timer);
    }
  }

  async function retrieveCourse(courseIdValue) {
    const courseId = String(courseIdValue || "").trim().toLowerCase();
    if (!COURSE_ID.test(courseId)) throw new Error("A canonical Academy course ID is required.");
    const result = await getJson(`/api/academy/course/${encodeURIComponent(courseId)}`);
    if (!result.ok) {
      return ownerSafe({ ok: false, state: "website-course-unavailable", courseId, status: result.status, requestId: result.requestId });
    }
    if (result.body?.ok !== true || result.body?.course?.id !== courseId) {
      return ownerSafe({ ok: false, state: "website-course-contract-mismatch", courseId, status: result.status, requestId: result.requestId });
    }
    return ownerSafe({
      ok: true,
      state: "verified-success",
      source: "website",
      courseId,
      course: result.body.course,
      generatedAt: result.body.generatedAt || null,
      status: result.status,
      requestId: result.requestId,
    });
  }

  async function retrieveCertificate(certificateIdValue) {
    const certificateId = String(certificateIdValue || "").trim().toUpperCase();
    if (!CERTIFICATE_ID.test(certificateId)) throw new Error("A canonical Obserra certificate ID is required.");
    const result = await getJson(`/api/academy/certificate/verify?certificateId=${encodeURIComponent(certificateId)}`);
    if (!result.ok || result.body?.valid !== true) {
      return ownerSafe({
        ok: false,
        state: result.status === 404 ? "certificate-not-found" : "certificate-verification-unavailable",
        certificateReference: maskReference(certificateId),
        status: result.status,
        verification: result.verification,
        requestId: result.requestId,
      });
    }
    const certificate = result.body;
    if (!COURSE_ID.test(String(certificate.courseId || "")) || !COURSE_VERSION.test(String(certificate.courseVersion || ""))) {
      return ownerSafe({
        ok: false,
        state: "certificate-contract-mismatch",
        certificateReference: maskReference(certificateId),
        status: result.status,
        verification: result.verification,
        requestId: result.requestId,
      });
    }
    return ownerSafe({
      ok: true,
      state: "verified-success",
      source: "website",
      certificate: {
        valid: true,
        certificateReference: maskReference(certificate.certificateId),
        learnerName: certificate.learnerName,
        courseId: certificate.courseId,
        courseTitle: certificate.courseTitle,
        courseVersion: certificate.courseVersion,
        completedAt: certificate.completedAt,
        trainingHours: certificate.trainingHours,
        signerName: certificate.signerName,
        issuer: certificate.issuer,
        signatureAlgorithm: certificate.signatureAlgorithm,
        publicKeyFingerprint: certificate.publicKeyFingerprint,
      },
      status: result.status,
      verification: result.verification,
      requestId: result.requestId,
    });
  }

  return { retrieveCourse, retrieveCertificate };
}

module.exports = { createAcademyWebsiteRetrieval, COURSE_ID, CERTIFICATE_ID, COURSE_VERSION };
