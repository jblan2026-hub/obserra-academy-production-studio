import "server-only";

import { timingSafeEqual } from "node:crypto";

export type AcademyDeliveryPrincipal = {
  actorId: string;
  learnerId: string | null;
  purpose: "readiness" | "learner-content" | "knowledge-check" | "assessment-grade";
};

const allowedPurposes = new Set<AcademyDeliveryPrincipal["purpose"]>([
  "readiness",
  "learner-content",
  "knowledge-check",
  "assessment-grade",
]);

function secureTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function authorizeAcademyDeliveryRequest(
  request: Request,
): { principal: AcademyDeliveryPrincipal | null; reason?: string } {
  const expected = process.env.ACADEMY_DELIVERY_TOKEN?.trim();
  const provided = request.headers.get("x-academy-delivery-token")?.trim();

  if (!expected || expected.length < 32) {
    return { principal: null, reason: "Academy delivery service is not configured" };
  }
  if (!provided || !secureTokenMatch(provided, expected)) {
    return { principal: null, reason: "Academy delivery authorization failed" };
  }

  const rawPurpose = request.headers.get("x-academy-delivery-purpose")?.trim() ?? "learner-content";
  if (!allowedPurposes.has(rawPurpose as AcademyDeliveryPrincipal["purpose"])) {
    return { principal: null, reason: "Academy delivery purpose is invalid" };
  }

  const purpose = rawPurpose as AcademyDeliveryPrincipal["purpose"];
  const learnerId = request.headers.get("x-academy-learner-id")?.trim() || null;
  if (purpose !== "readiness" && !learnerId) {
    return { principal: null, reason: "A named learner is required" };
  }

  return {
    principal: {
      actorId: request.headers.get("x-academy-actor-id")?.trim() || "obserra-website",
      learnerId,
      purpose,
    },
  };
}
