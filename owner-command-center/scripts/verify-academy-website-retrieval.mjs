import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAcademyWebsiteRetrieval } = require("../electron/academy-website-retrieval.cjs");

function makeStore(overrides = {}) {
  return {
    get(key) {
      return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
    },
  };
}

const safeStorage = {
  isEncryptionAvailable: () => true,
  decryptString: () => "test-token",
};

const originalFetch = globalThis.fetch;
try {
  {
    const retrieval = createAcademyWebsiteRetrieval({
      store: makeStore({ "connectors.website.url": "http://example.com" }),
      safeStorage,
    });
    await assert.rejects(() => retrieval.retrieveCourse("cybersecurity-foundations"), /requires HTTPS/i);
  }

  {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "www.obserrallc.com");
      assert.equal(url.pathname, "/api/academy/course/cybersecurity-foundations");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({
        ok: true,
        generatedAt: "2026-08-08T00:00:00.000Z",
        course: {
          id: "cybersecurity-foundations",
          title: "Cybersecurity Foundations for New Professionals",
          price: 99,
          modules: [],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "course-test-request" },
      });
    };
    const retrieval = createAcademyWebsiteRetrieval({ store: makeStore(), safeStorage });
    const result = await retrieval.retrieveCourse("cybersecurity-foundations");
    assert.equal(result.ok, true);
    assert.equal(result.state, "verified-success");
    assert.equal(result.courseId, "cybersecurity-foundations");
    assert.equal(result.course.id, "cybersecurity-foundations");
  }

  {
    const certificateId = "OBS-CYBERSECURITYFOUNDATIONS-1A2B3C4D";
    globalThis.fetch = async (url, options) => {
      assert.equal(url.protocol, "https:");
      assert.equal(url.pathname, "/api/academy/certificate/verify");
      assert.equal(url.searchParams.get("certificateId"), certificateId);
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({
        valid: true,
        certificateId,
        learnerName: "Test Learner",
        courseId: "cybersecurity-foundations",
        courseTitle: "Cybersecurity Foundations for New Professionals",
        completedAt: "2026-08-08T00:00:00.000Z",
        trainingHours: "2.5 hours",
        signerName: "Obserra Academy",
        issuer: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
        signatureAlgorithm: "Ed25519",
        publicKeyFingerprint: "sha256:test-fingerprint",
        assessmentScore: 100,
      }), {
        status: 200,
        headers: { "x-obserra-certificate-verification": "valid" },
      });
    };
    const retrieval = createAcademyWebsiteRetrieval({ store: makeStore(), safeStorage });
    const result = await retrieval.retrieveCertificate(certificateId);
    assert.equal(result.ok, true);
    assert.equal(result.state, "verified-success");
    assert.notEqual(result.certificate.certificateReference, certificateId);
    assert.equal(result.certificate.learnerName, "Test Learner");
    assert.equal("assessmentScore" in result.certificate, false);
    assert.equal(JSON.stringify(result).includes(certificateId), false);
  }

  {
    globalThis.fetch = async () => new Response("<html>not json</html>", { status: 200 });
    const retrieval = createAcademyWebsiteRetrieval({ store: makeStore(), safeStorage });
    await assert.rejects(() => retrieval.retrieveCourse("cybersecurity-foundations"), /non-JSON response/i);
  }

  console.log("Academy website retrieval controls passed: HTTPS-only origin binding, published course contract validation, certificate minimization/masking, redirect denial, and malformed response rejection are enforced.");
} finally {
  globalThis.fetch = originalFetch;
}
