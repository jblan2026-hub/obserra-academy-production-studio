import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

const COURSE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CERTIFICATE_PATTERN = /^OBS-[A-Z0-9]+-[A-F0-9]{8}$/;
const MAX_PROGRESS_SECONDS = 60 * 60 * 24 * 30;
const CERTIFICATE_ISSUER = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = PrismaClient | TransactionClient;

type JsonObject = Record<string, unknown>;

export type LearnerIdentity = {
  clerkUserId: string;
  email?: string | null;
  displayName?: string | null;
};

export type CommerceFulfillmentInput = {
  provider: "stripe";
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  checkoutSessionId: string;
  paymentIntentId?: string | null;
  courseSlug: string;
  clerkUserId?: string | null;
  purchaserReference?: string | null;
  purchaserEmail?: string | null;
  purchaserName?: string | null;
  amountCents: number;
  currency: string;
  paidAt: string;
  metadata?: JsonObject;
};

export type LessonProgressInput = {
  lessonId: string;
  progressPercent: number;
  lastPositionSeconds: number;
  completed: boolean;
};

export type AssessmentSubmissionInput = {
  answers: Record<string, number>;
};

export class LearnerDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "LearnerDeliveryError";
  }
}

type LearnerRow = {
  id: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
};

type CourseRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  version: number;
};

type EnrollmentRow = {
  enrollmentId: string;
  learnerId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseSummary: string | null;
  courseVersion: number;
  enrollmentStatus: string;
  currentLessonId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastAccessedAt: Date | null;
  passingScore: number;
  allLessonsRequired: boolean;
  assessmentRequired: boolean;
  assessmentDurationMinutes: number | null;
  certificateIssued: boolean;
  certificateTitle: string;
  credentialDisclaimer: string;
  policyMetadata: Prisma.JsonValue | null;
};

type LessonRow = {
  id: string;
  title: string;
  position: number;
  objective: string | null;
  content: Prisma.JsonValue | null;
  progressStatus: string | null;
  progressPercent: number | null;
  lastPositionSeconds: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

type AssessmentRow = {
  id: string;
  lessonId: string;
  prompt: string;
  options: Prisma.JsonValue | null;
  answerKey: Prisma.JsonValue | null;
  rationale: string | null;
};

type AssetRow = {
  id: string;
  courseId: string;
  lessonId: string | null;
  assetKey: string;
  assetType: string;
  title: string;
  storageKey: string | null;
  inlineContent: string | null;
  mimeType: string | null;
  availabilityStatus: string;
  isDownloadable: boolean;
  position: number;
  checksumSha256: string | null;
  durationSeconds: number | null;
  metadata: Prisma.JsonValue | null;
};

type CertificateRow = {
  certificateNumber: string;
  learnerId: string;
  clerkUserId: string;
  learnerName: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  trainingHours: string;
  assessmentScore: number;
  status: string;
  issuedAt: Date;
  revokedAt: Date | null;
  verificationHash: string;
  metadata: Prisma.JsonValue | null;
};

function assertSafeText(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new LearnerDeliveryError(`${name} is invalid.`, 400, `INVALID_${name.toUpperCase()}`);
  }
  return normalized;
}

function assertCourseSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!COURSE_SLUG_PATTERN.test(normalized)) {
    throw new LearnerDeliveryError("Course identifier is invalid.", 400, "INVALID_COURSE_ID");
  }
  return normalized;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized && normalized.length <= 320 ? normalized : null;
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function jsonObject(value: Prisma.JsonValue | null): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function sanitizeLessonContent(value: Prisma.JsonValue | null): JsonObject {
  const source = jsonObject(value);
  const {
    videoScript: _videoScript,
    sourcePlaceholders: _sourcePlaceholders,
    authoringReviewStatus: _authoringReviewStatus,
    sourceManifest: _sourceManifest,
    sourceManifestHash: _sourceManifestHash,
    ...learnerContent
  } = source;
  return learnerContent;
}

function parseCorrectIndex(answerKey: Prisma.JsonValue | null): number | null {
  const record = jsonObject(answerKey);
  const index = Number(record.correctIndex);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function certificateSecret(): string {
  const secret = process.env.ACADEMY_CERTIFICATE_SIGNING_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new LearnerDeliveryError(
      "Certificate signing is not configured.",
      503,
      "CERTIFICATE_SIGNING_UNAVAILABLE",
    );
  }
  return secret;
}

function certificateCanonical(record: {
  certificateNumber: string;
  clerkUserId: string;
  courseSlug: string;
  issuedAt: string;
  assessmentScore: number;
}): string {
  return [
    "obserra-academy-certificate-v1",
    record.certificateNumber,
    record.clerkUserId,
    record.courseSlug,
    record.issuedAt,
    String(record.assessmentScore),
  ].join("\n");
}

function signCertificate(record: Parameters<typeof certificateCanonical>[0]): string {
  return createHmac("sha256", certificateSecret())
    .update(certificateCanonical(record), "utf8")
    .digest("hex");
}

function verifyCertificateHash(record: CertificateRow): boolean {
  try {
    const expected = Buffer.from(signCertificate({
      certificateNumber: record.certificateNumber,
      clerkUserId: record.clerkUserId,
      courseSlug: record.courseSlug,
      issuedAt: record.issuedAt.toISOString(),
      assessmentScore: record.assessmentScore,
    }), "hex");
    const received = Buffer.from(record.verificationHash, "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

async function upsertLearner(
  database: TransactionClient,
  identity: LearnerIdentity,
): Promise<LearnerRow> {
  const clerkUserId = assertSafeText(identity.clerkUserId, "clerkUserId", 256);
  const email = normalizedEmail(identity.email);
  const displayName = identity.displayName?.trim().slice(0, 300) || null;
  const rows = await database.$queryRaw<LearnerRow[]>(Prisma.sql`
    INSERT INTO "LearnerAccount" (
      "id", "clerkUserId", "email", "displayName", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${clerkUserId}, ${email}, ${displayName}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("clerkUserId") DO UPDATE SET
      "email" = COALESCE(EXCLUDED."email", "LearnerAccount"."email"),
      "displayName" = COALESCE(EXCLUDED."displayName", "LearnerAccount"."displayName"),
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING
      "id",
      "clerkUserId",
      "email",
      "displayName"
  `);
  const learner = rows[0];
  if (!learner) {
    throw new LearnerDeliveryError("Learner account could not be created.", 500, "LEARNER_CREATE_FAILED");
  }
  return learner;
}

async function publishedCourse(
  database: DatabaseClient,
  courseSlug: string,
): Promise<CourseRow | null> {
  const rows = await database.$queryRaw<CourseRow[]>(Prisma.sql`
    SELECT
      course."id",
      course."slug",
      course."title",
      course."summary",
      course."status"::text AS "status",
      course."version"
    FROM "Course" course
    WHERE
      course."slug" = ${courseSlug}
      AND course."status" = 'PUBLISHED'
      AND EXISTS (
        SELECT 1
        FROM "Release" release
        WHERE
          release."courseId" = course."id"
          AND release."status" = 'PUBLISHED'
      )
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function upsertPurchaseAndAccess(
  transaction: TransactionClient,
  input: CommerceFulfillmentInput,
  course: CourseRow,
  learner: LearnerRow,
): Promise<{ purchaseId: string; entitlementId: string; enrollmentId: string }> {
  const purchaseId = randomUUID();
  const purchaseRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "CoursePurchase" (
      "id", "courseId", "learnerId", "provider", "checkoutSessionId", "paymentIntentId",
      "purchaserReference", "purchaserEmail", "amountCents", "currency", "status", "paidAt",
      "metadata", "createdAt", "updatedAt"
    ) VALUES (
      ${purchaseId}, ${course.id}, ${learner.id}, ${input.provider}, ${input.checkoutSessionId},
      ${input.paymentIntentId ?? null}, ${input.purchaserReference ?? null},
      ${normalizedEmail(input.purchaserEmail)}, ${input.amountCents}, ${input.currency}, 'PAID',
      ${new Date(input.paidAt)}, ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("checkoutSessionId") DO UPDATE SET
      "learnerId" = EXCLUDED."learnerId",
      "paymentIntentId" = COALESCE(EXCLUDED."paymentIntentId", "CoursePurchase"."paymentIntentId"),
      "status" = 'PAID',
      "paidAt" = EXCLUDED."paidAt",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
  `);
  const persistedPurchaseId = purchaseRows[0]?.id;
  if (!persistedPurchaseId) {
    throw new LearnerDeliveryError("Purchase could not be persisted.", 500, "PURCHASE_PERSIST_FAILED");
  }

  const entitlementRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "CourseEntitlement" (
      "id", "learnerId", "courseId", "purchaseId", "status", "source", "grantedAt",
      "metadata", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${learner.id}, ${course.id}, ${persistedPurchaseId}, 'ACTIVE',
      'stripe-checkout', CURRENT_TIMESTAMP,
      ${JSON.stringify({ providerEventId: input.providerEventId })}::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("learnerId", "courseId") DO UPDATE SET
      "purchaseId" = EXCLUDED."purchaseId",
      "status" = 'ACTIVE',
      "revokedAt" = NULL,
      "expiresAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
  `);
  const entitlementId = entitlementRows[0]?.id;
  if (!entitlementId) {
    throw new LearnerDeliveryError("Entitlement could not be granted.", 500, "ENTITLEMENT_GRANT_FAILED");
  }

  const enrollmentRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "CourseEnrollment" (
      "id", "learnerId", "courseId", "entitlementId", "status", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${learner.id}, ${course.id}, ${entitlementId}, 'NOT_STARTED',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("learnerId", "courseId") DO UPDATE SET
      "entitlementId" = EXCLUDED."entitlementId",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
  `);
  const enrollmentId = enrollmentRows[0]?.id;
  if (!enrollmentId) {
    throw new LearnerDeliveryError("Enrollment could not be created.", 500, "ENROLLMENT_CREATE_FAILED");
  }

  return { purchaseId: persistedPurchaseId, entitlementId, enrollmentId };
}

export async function fulfillCommercePurchase(input: CommerceFulfillmentInput) {
  const courseSlug = assertCourseSlug(input.courseSlug);
  assertSafeText(input.providerEventId, "providerEventId", 500);
  assertSafeText(input.eventType, "eventType", 200);
  assertSafeText(input.checkoutSessionId, "checkoutSessionId", 500);
  const currency = input.currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new LearnerDeliveryError("Currency is invalid.", 400, "INVALID_CURRENCY");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 100_000_000) {
    throw new LearnerDeliveryError("Purchase amount is invalid.", 400, "INVALID_AMOUNT");
  }
  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) {
    throw new LearnerDeliveryError("Paid timestamp is invalid.", 400, "INVALID_PAID_AT");
  }

  return prisma.$transaction(async (transaction) => {
    const eventRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "CommerceEvent" (
        "id", "provider", "providerEventId", "eventType", "payloadHash", "status",
        "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${input.provider}, ${input.providerEventId}, ${input.eventType},
        ${input.payloadHash}, 'RECEIVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("providerEventId") DO NOTHING
      RETURNING "id"
    `);

    if (eventRows.length === 0) {
      const existing = await transaction.$queryRaw<Array<{ status: string; errorCode: string | null }>>(Prisma.sql`
        SELECT "status", "errorCode"
        FROM "CommerceEvent"
        WHERE "providerEventId" = ${input.providerEventId}
        LIMIT 1
      `);
      return {
        state: "idempotent" as const,
        eventStatus: existing[0]?.status ?? "UNKNOWN",
        errorCode: existing[0]?.errorCode ?? null,
      };
    }

    const course = await publishedCourse(transaction, courseSlug);
    if (!course) {
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "CommerceEvent"
        SET "status" = 'REJECTED', "errorCode" = 'COURSE_NOT_PUBLISHED',
            "processedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "providerEventId" = ${input.providerEventId}
      `);
      return { state: "rejected" as const, reason: "course-not-published" };
    }

    const clerkUserId = input.clerkUserId?.trim() || null;
    if (!clerkUserId) {
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "CoursePurchase" (
          "id", "courseId", "learnerId", "provider", "checkoutSessionId", "paymentIntentId",
          "purchaserReference", "purchaserEmail", "amountCents", "currency", "status", "paidAt",
          "metadata", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${course.id}, NULL, ${input.provider}, ${input.checkoutSessionId},
          ${input.paymentIntentId ?? null}, ${input.purchaserReference ?? null},
          ${normalizedEmail(input.purchaserEmail)}, ${input.amountCents}, ${currency},
          'PAID_PENDING_CLAIM', ${paidAt},
          ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("checkoutSessionId") DO UPDATE SET
          "status" = CASE
            WHEN "CoursePurchase"."learnerId" IS NULL THEN 'PAID_PENDING_CLAIM'
            ELSE 'PAID'
          END,
          "paidAt" = EXCLUDED."paidAt",
          "updatedAt" = CURRENT_TIMESTAMP
      `);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "CommerceEvent"
        SET "status" = 'PROCESSED', "processedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "providerEventId" = ${input.providerEventId}
      `);
      return {
        state: "paid-pending-account-claim" as const,
        courseSlug: course.slug,
        checkoutSessionId: input.checkoutSessionId,
      };
    }

    const learner = await upsertLearner(transaction, {
      clerkUserId,
      email: input.purchaserEmail,
      displayName: input.purchaserName,
    });
    const access = await upsertPurchaseAndAccess(transaction, input, course, learner);

    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "AuditEvent" (
        "id", "organizationId", "actorId", "actorType", "action", "resourceType",
        "resourceId", "correlationId", "outcome", "metadata", "createdAt"
      )
      SELECT
        ${randomUUID()}, course."organizationId", ${learner.clerkUserId}, 'commerce-service',
        'learner.entitlement.grant', 'CourseEntitlement', ${access.entitlementId},
        ${input.providerEventId}, 'success',
        ${JSON.stringify({
          courseSlug: course.slug,
          checkoutSessionId: input.checkoutSessionId,
          purchaseId: access.purchaseId,
          enrollmentId: access.enrollmentId,
        })}::jsonb,
        CURRENT_TIMESTAMP
      FROM "Course" course
      WHERE course."id" = ${course.id}
    `);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "CommerceEvent"
      SET "status" = 'PROCESSED', "processedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "providerEventId" = ${input.providerEventId}
    `);

    return {
      state: "fulfilled" as const,
      courseSlug: course.slug,
      enrollmentId: access.enrollmentId,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimPaidPurchase(
  identity: LearnerIdentity,
  checkoutSessionId: string,
  verifiedEmail: string,
) {
  const normalizedCheckout = assertSafeText(checkoutSessionId, "checkoutSessionId", 500);
  const email = normalizedEmail(verifiedEmail);
  if (!email) {
    throw new LearnerDeliveryError("A verified purchaser email is required.", 400, "VERIFIED_EMAIL_REQUIRED");
  }

  return prisma.$transaction(async (transaction) => {
    const purchases = await transaction.$queryRaw<Array<{
      id: string;
      courseId: string;
      courseSlug: string;
      provider: string;
      checkoutSessionId: string;
      paymentIntentId: string | null;
      purchaserReference: string | null;
      purchaserEmail: string | null;
      amountCents: number;
      currency: string;
      paidAt: Date;
      metadata: Prisma.JsonValue | null;
      status: string;
    }>>(Prisma.sql`
      SELECT
        purchase."id",
        purchase."courseId",
        course."slug" AS "courseSlug",
        purchase."provider",
        purchase."checkoutSessionId",
        purchase."paymentIntentId",
        purchase."purchaserReference",
        purchase."purchaserEmail",
        purchase."amountCents",
        purchase."currency",
        purchase."paidAt",
        purchase."metadata",
        purchase."status"
      FROM "CoursePurchase" purchase
      JOIN "Course" course ON course."id" = purchase."courseId"
      WHERE purchase."checkoutSessionId" = ${normalizedCheckout}
      FOR UPDATE
    `);
    const purchase = purchases[0];
    if (!purchase) {
      throw new LearnerDeliveryError("Paid purchase was not found.", 404, "PURCHASE_NOT_FOUND");
    }
    if (purchase.status === "REFUNDED" || purchase.status === "DISPUTED" || purchase.status === "CANCELED") {
      throw new LearnerDeliveryError("This purchase is not eligible for access.", 409, "PURCHASE_NOT_ELIGIBLE");
    }
    if (normalizedEmail(purchase.purchaserEmail) !== email) {
      throw new LearnerDeliveryError("Purchaser identity does not match.", 403, "PURCHASER_IDENTITY_MISMATCH");
    }

    const course = await publishedCourse(transaction, purchase.courseSlug);
    if (!course) {
      throw new LearnerDeliveryError("Course is not available for enrollment.", 409, "COURSE_NOT_PUBLISHED");
    }
    const learner = await upsertLearner(transaction, {
      ...identity,
      email,
    });
    const access = await upsertPurchaseAndAccess(transaction, {
      provider: "stripe",
      providerEventId: `claim:${purchase.checkoutSessionId}`,
      eventType: "purchase.claim",
      payloadHash: "claim",
      checkoutSessionId: purchase.checkoutSessionId,
      paymentIntentId: purchase.paymentIntentId,
      courseSlug: purchase.courseSlug,
      clerkUserId: learner.clerkUserId,
      purchaserReference: purchase.purchaserReference,
      purchaserEmail: purchase.purchaserEmail,
      amountCents: purchase.amountCents,
      currency: purchase.currency,
      paidAt: purchase.paidAt.toISOString(),
      metadata: jsonObject(purchase.metadata),
    }, course, learner);

    return {
      state: "fulfilled" as const,
      courseSlug: course.slug,
      enrollmentId: access.enrollmentId,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function learnerByClerkUserId(clerkUserId: string): Promise<LearnerRow | null> {
  const rows = await prisma.$queryRaw<LearnerRow[]>(Prisma.sql`
    SELECT "id", "clerkUserId", "email", "displayName"
    FROM "LearnerAccount"
    WHERE "clerkUserId" = ${clerkUserId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function entitledEnrollment(
  clerkUserId: string,
  courseSlug: string,
): Promise<EnrollmentRow> {
  const rows = await prisma.$queryRaw<EnrollmentRow[]>(Prisma.sql`
    SELECT
      enrollment."id" AS "enrollmentId",
      learner."id" AS "learnerId",
      course."id" AS "courseId",
      course."slug" AS "courseSlug",
      course."title" AS "courseTitle",
      course."summary" AS "courseSummary",
      course."version" AS "courseVersion",
      enrollment."status" AS "enrollmentStatus",
      enrollment."currentLessonId",
      enrollment."startedAt",
      enrollment."completedAt",
      enrollment."lastAccessedAt",
      policy."passingScore",
      policy."allLessonsRequired",
      policy."assessmentRequired",
      policy."assessmentDurationMinutes",
      policy."certificateIssued",
      policy."certificateTitle",
      policy."credentialDisclaimer",
      policy."metadata" AS "policyMetadata"
    FROM "LearnerAccount" learner
    JOIN "CourseEntitlement" entitlement
      ON entitlement."learnerId" = learner."id"
      AND entitlement."status" = 'ACTIVE'
      AND (entitlement."expiresAt" IS NULL OR entitlement."expiresAt" > CURRENT_TIMESTAMP)
    JOIN "Course" course ON course."id" = entitlement."courseId"
    JOIN "CourseEnrollment" enrollment
      ON enrollment."learnerId" = learner."id"
      AND enrollment."courseId" = course."id"
    JOIN "CourseDeliveryPolicy" policy ON policy."courseId" = course."id"
    WHERE learner."clerkUserId" = ${clerkUserId} AND course."slug" = ${courseSlug}
    LIMIT 1
  `);
  const enrollment = rows[0];
  if (!enrollment) {
    throw new LearnerDeliveryError("An active course entitlement is required.", 403, "ENTITLEMENT_REQUIRED");
  }
  return enrollment;
}

export async function learnerLibrary(clerkUserId: string) {
  const learnerId = assertSafeText(clerkUserId, "clerkUserId", 256);
  const rows = await prisma.$queryRaw<Array<{
    courseSlug: string;
    title: string;
    summary: string | null;
    version: number;
    enrollmentStatus: string;
    startedAt: Date | null;
    completedAt: Date | null;
    lastAccessedAt: Date | null;
    lessonCount: bigint;
    completedLessonCount: bigint;
    certificateNumber: string | null;
  }>>(Prisma.sql`
    SELECT
      course."slug" AS "courseSlug",
      course."title",
      course."summary",
      course."version",
      enrollment."status" AS "enrollmentStatus",
      enrollment."startedAt",
      enrollment."completedAt",
      enrollment."lastAccessedAt",
      COUNT(DISTINCT lesson."id") AS "lessonCount",
      COUNT(DISTINCT progress."lessonId") FILTER (WHERE progress."status" = 'COMPLETED') AS "completedLessonCount",
      certificate."certificateNumber"
    FROM "LearnerAccount" learner
    JOIN "CourseEntitlement" entitlement
      ON entitlement."learnerId" = learner."id"
      AND entitlement."status" = 'ACTIVE'
      AND (entitlement."expiresAt" IS NULL OR entitlement."expiresAt" > CURRENT_TIMESTAMP)
    JOIN "Course" course ON course."id" = entitlement."courseId"
    JOIN "CourseEnrollment" enrollment
      ON enrollment."learnerId" = learner."id"
      AND enrollment."courseId" = course."id"
    LEFT JOIN "Lesson" lesson ON lesson."courseId" = course."id"
    LEFT JOIN "LessonProgress" progress
      ON progress."enrollmentId" = enrollment."id"
      AND progress."lessonId" = lesson."id"
    LEFT JOIN "CourseCertificate" certificate
      ON certificate."enrollmentId" = enrollment."id"
      AND certificate."status" = 'ACTIVE'
    WHERE learner."clerkUserId" = ${learnerId}
    GROUP BY course."id", enrollment."id", certificate."certificateNumber"
    ORDER BY COALESCE(enrollment."lastAccessedAt", enrollment."createdAt") DESC
  `);

  return rows.map((row) => ({
    courseSlug: row.courseSlug,
    title: row.title,
    summary: row.summary,
    version: row.version,
    enrollmentStatus: row.enrollmentStatus,
    startedAt: isoDate(row.startedAt),
    completedAt: isoDate(row.completedAt),
    lastAccessedAt: isoDate(row.lastAccessedAt),
    lessonCount: Number(row.lessonCount),
    completedLessonCount: Number(row.completedLessonCount),
    certificateNumber: row.certificateNumber,
    learnerUrl: `/learner/courses/${encodeURIComponent(row.courseSlug)}`,
  }));
}

export async function learnerCourse(clerkUserId: string, rawCourseSlug: string) {
  const courseSlug = assertCourseSlug(rawCourseSlug);
  const enrollment = await entitledEnrollment(clerkUserId, courseSlug);

  const [lessons, assets] = await Promise.all([
    prisma.$queryRaw<LessonRow[]>(Prisma.sql`
      SELECT
        lesson."id",
        lesson."title",
        lesson."position",
        lesson."objective",
        lesson."content",
        progress."status" AS "progressStatus",
        progress."progressPercent",
        progress."lastPositionSeconds",
        progress."startedAt",
        progress."completedAt"
      FROM "Lesson" lesson
      LEFT JOIN "LessonProgress" progress
        ON progress."lessonId" = lesson."id"
        AND progress."enrollmentId" = ${enrollment.enrollmentId}
      WHERE lesson."courseId" = ${enrollment.courseId}
      ORDER BY lesson."position" ASC
    `),
    prisma.$queryRaw<AssetRow[]>(Prisma.sql`
      SELECT
        "id", "courseId", "lessonId", "assetKey", "assetType", "title", "storageKey",
        "inlineContent", "mimeType", "availabilityStatus", "isDownloadable", "position",
        "checksumSha256", "durationSeconds", "metadata"
      FROM "CourseDeliveryAsset"
      WHERE "courseId" = ${enrollment.courseId} AND "availabilityStatus" = 'READY'
      ORDER BY "position" ASC, "title" ASC
    `),
  ]);

  await prisma.$executeRaw(Prisma.sql`
    UPDATE "CourseEnrollment"
    SET
      "status" = CASE WHEN "status" = 'NOT_STARTED' THEN 'IN_PROGRESS' ELSE "status" END,
      "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
      "lastAccessedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${enrollment.enrollmentId}
  `);

  const assetsByLesson = new Map<string, Array<ReturnType<typeof publicAsset>>>();
  const courseAssets: Array<ReturnType<typeof publicAsset>> = [];
  for (const asset of assets) {
    const projected = publicAsset(asset);
    if (asset.lessonId) {
      const list = assetsByLesson.get(asset.lessonId) ?? [];
      list.push(projected);
      assetsByLesson.set(asset.lessonId, list);
    } else {
      courseAssets.push(projected);
    }
  }

  const completedLessonCount = lessons.filter((lesson) => lesson.progressStatus === "COMPLETED").length;
  const allLessonsCompleted = lessons.length > 0 && completedLessonCount === lessons.length;

  return {
    course: {
      slug: enrollment.courseSlug,
      title: enrollment.courseTitle,
      summary: enrollment.courseSummary,
      version: enrollment.courseVersion,
      policy: {
        allLessonsRequired: enrollment.allLessonsRequired,
        assessmentRequired: enrollment.assessmentRequired,
        assessmentDurationMinutes: enrollment.assessmentDurationMinutes,
        passingScore: enrollment.passingScore,
        certificateIssued: enrollment.certificateIssued,
        certificateTitle: enrollment.certificateTitle,
        credentialDisclaimer: enrollment.credentialDisclaimer,
        metadata: jsonObject(enrollment.policyMetadata),
      },
      materials: courseAssets,
    },
    enrollment: {
      id: enrollment.enrollmentId,
      status: enrollment.enrollmentStatus,
      currentLessonId: enrollment.currentLessonId,
      startedAt: isoDate(enrollment.startedAt),
      completedAt: isoDate(enrollment.completedAt),
      lastAccessedAt: new Date().toISOString(),
      completedLessonCount,
      lessonCount: lessons.length,
      allLessonsCompleted,
      finalAssessmentAvailable: enrollment.assessmentRequired && allLessonsCompleted,
    },
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      position: lesson.position,
      objective: lesson.objective,
      content: sanitizeLessonContent(lesson.content),
      assets: assetsByLesson.get(lesson.id) ?? [],
      progress: {
        status: lesson.progressStatus ?? "NOT_STARTED",
        progressPercent: lesson.progressPercent ?? 0,
        lastPositionSeconds: lesson.lastPositionSeconds ?? 0,
        startedAt: isoDate(lesson.startedAt),
        completedAt: isoDate(lesson.completedAt),
      },
    })),
  };
}

function publicAsset(asset: AssetRow) {
  return {
    id: asset.id,
    key: asset.assetKey,
    type: asset.assetType,
    title: asset.title,
    mimeType: asset.mimeType,
    downloadable: asset.isDownloadable,
    durationSeconds: asset.durationSeconds,
    checksumSha256: asset.checksumSha256,
    metadata: jsonObject(asset.metadata),
    deliveryUrl: `/api/learner/media/${encodeURIComponent(asset.id)}`,
  };
}

export async function updateLessonProgress(
  clerkUserId: string,
  rawCourseSlug: string,
  input: LessonProgressInput,
) {
  const courseSlug = assertCourseSlug(rawCourseSlug);
  const enrollment = await entitledEnrollment(clerkUserId, courseSlug);
  const lessonId = assertSafeText(input.lessonId, "lessonId", 256);
  if (!Number.isSafeInteger(input.progressPercent) || input.progressPercent < 0 || input.progressPercent > 100) {
    throw new LearnerDeliveryError("Progress percentage is invalid.", 400, "INVALID_PROGRESS");
  }
  if (
    !Number.isSafeInteger(input.lastPositionSeconds)
    || input.lastPositionSeconds < 0
    || input.lastPositionSeconds > MAX_PROGRESS_SECONDS
  ) {
    throw new LearnerDeliveryError("Playback position is invalid.", 400, "INVALID_POSITION");
  }

  const lessons = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Lesson"
    WHERE "id" = ${lessonId} AND "courseId" = ${enrollment.courseId}
    LIMIT 1
  `);
  if (!lessons[0]) {
    throw new LearnerDeliveryError("Lesson was not found in this course.", 404, "LESSON_NOT_FOUND");
  }

  const completed = input.completed || input.progressPercent === 100;
  const status = completed ? "COMPLETED" : input.progressPercent > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  const progressPercent = completed ? 100 : input.progressPercent;

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "LessonProgress" (
        "id", "enrollmentId", "lessonId", "status", "progressPercent",
        "lastPositionSeconds", "startedAt", "completedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${enrollment.enrollmentId}, ${lessonId}, ${status}, ${progressPercent},
        ${input.lastPositionSeconds},
        CASE WHEN ${progressPercent} > 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN ${completed} THEN CURRENT_TIMESTAMP ELSE NULL END,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("enrollmentId", "lessonId") DO UPDATE SET
        "status" = EXCLUDED."status",
        "progressPercent" = GREATEST("LessonProgress"."progressPercent", EXCLUDED."progressPercent"),
        "lastPositionSeconds" = EXCLUDED."lastPositionSeconds",
        "startedAt" = COALESCE("LessonProgress"."startedAt", EXCLUDED."startedAt"),
        "completedAt" = CASE
          WHEN EXCLUDED."status" = 'COMPLETED' THEN COALESCE("LessonProgress"."completedAt", CURRENT_TIMESTAMP)
          ELSE "LessonProgress"."completedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "CourseEnrollment"
      SET
        "status" = CASE WHEN "status" = 'COMPLETED' THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
        "currentLessonId" = ${lessonId},
        "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
        "lastAccessedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${enrollment.enrollmentId}
    `);
  });

  const summary = await courseProgressSummary(enrollment.enrollmentId, enrollment.courseId);
  return {
    lessonId,
    status,
    progressPercent,
    lastPositionSeconds: input.lastPositionSeconds,
    ...summary,
  };
}

async function courseProgressSummary(enrollmentId: string, courseId: string) {
  const rows = await prisma.$queryRaw<Array<{ lessonCount: bigint; completedLessonCount: bigint }>>(Prisma.sql`
    SELECT
      COUNT(lesson."id") AS "lessonCount",
      COUNT(progress."lessonId") FILTER (WHERE progress."status" = 'COMPLETED') AS "completedLessonCount"
    FROM "Lesson" lesson
    LEFT JOIN "LessonProgress" progress
      ON progress."lessonId" = lesson."id"
      AND progress."enrollmentId" = ${enrollmentId}
    WHERE lesson."courseId" = ${courseId}
  `);
  const lessonCount = Number(rows[0]?.lessonCount ?? 0);
  const completedLessonCount = Number(rows[0]?.completedLessonCount ?? 0);
  return {
    lessonCount,
    completedLessonCount,
    allLessonsCompleted: lessonCount > 0 && lessonCount === completedLessonCount,
  };
}

export async function finalAssessment(clerkUserId: string, rawCourseSlug: string) {
  const courseSlug = assertCourseSlug(rawCourseSlug);
  const enrollment = await entitledEnrollment(clerkUserId, courseSlug);
  const progress = await courseProgressSummary(enrollment.enrollmentId, enrollment.courseId);
  if (enrollment.allLessonsRequired && !progress.allLessonsCompleted) {
    throw new LearnerDeliveryError(
      "Complete every lesson before starting the final assessment.",
      409,
      "LESSONS_INCOMPLETE",
    );
  }

  const questions = await prisma.$queryRaw<AssessmentRow[]>(Prisma.sql`
    SELECT assessment."id", assessment."lessonId", assessment."prompt", assessment."options",
           NULL::jsonb AS "answerKey", NULL::text AS "rationale"
    FROM "Assessment" assessment
    JOIN "Lesson" lesson ON lesson."id" = assessment."lessonId"
    WHERE lesson."courseId" = ${enrollment.courseId} AND assessment."kind" = 'final-assessment'
    ORDER BY assessment."createdAt" ASC, assessment."id" ASC
  `);
  if (questions.length === 0) {
    throw new LearnerDeliveryError("Final assessment is not available.", 409, "ASSESSMENT_UNAVAILABLE");
  }

  return {
    courseSlug,
    passingScore: enrollment.passingScore,
    durationMinutes: enrollment.assessmentDurationMinutes,
    questionCount: questions.length,
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
    })),
  };
}

export async function submitFinalAssessment(
  identity: LearnerIdentity,
  rawCourseSlug: string,
  input: AssessmentSubmissionInput,
) {
  const courseSlug = assertCourseSlug(rawCourseSlug);
  const enrollment = await entitledEnrollment(identity.clerkUserId, courseSlug);
  const progress = await courseProgressSummary(enrollment.enrollmentId, enrollment.courseId);
  if (enrollment.allLessonsRequired && !progress.allLessonsCompleted) {
    throw new LearnerDeliveryError(
      "Complete every lesson before submitting the final assessment.",
      409,
      "LESSONS_INCOMPLETE",
    );
  }
  if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) {
    throw new LearnerDeliveryError("Assessment answers are invalid.", 400, "INVALID_ANSWERS");
  }

  const questions = await prisma.$queryRaw<AssessmentRow[]>(Prisma.sql`
    SELECT assessment."id", assessment."lessonId", assessment."prompt", assessment."options",
           assessment."answerKey", assessment."rationale"
    FROM "Assessment" assessment
    JOIN "Lesson" lesson ON lesson."id" = assessment."lessonId"
    WHERE lesson."courseId" = ${enrollment.courseId} AND assessment."kind" = 'final-assessment'
    ORDER BY assessment."createdAt" ASC, assessment."id" ASC
  `);
  if (questions.length === 0) {
    throw new LearnerDeliveryError("Final assessment is not available.", 409, "ASSESSMENT_UNAVAILABLE");
  }

  let correct = 0;
  const results: Array<{
    questionId: string;
    selectedIndex: number;
    correct: boolean;
    rationale: string | null;
  }> = [];
  for (const question of questions) {
    const selectedIndex = Number(input.answers[question.id]);
    if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0) {
      throw new LearnerDeliveryError(
        "Every assessment question requires one valid answer.",
        400,
        "INCOMPLETE_ASSESSMENT",
      );
    }
    const correctIndex = parseCorrectIndex(question.answerKey);
    if (correctIndex === null) {
      throw new LearnerDeliveryError(
        "Assessment answer key is incomplete.",
        503,
        "ASSESSMENT_KEY_UNAVAILABLE",
      );
    }
    const isCorrect = selectedIndex === correctIndex;
    if (isCorrect) correct += 1;
    results.push({
      questionId: question.id,
      selectedIndex,
      correct: isCorrect,
      rationale: question.rationale,
    });
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= enrollment.passingScore;
  const learner = await learnerByClerkUserId(identity.clerkUserId);
  if (!learner) {
    throw new LearnerDeliveryError("Learner account was not found.", 404, "LEARNER_NOT_FOUND");
  }

  return prisma.$transaction(async (transaction) => {
    const attemptRows = await transaction.$queryRaw<Array<{ nextAttempt: bigint }>>(Prisma.sql`
      SELECT COALESCE(MAX("attemptNumber"), 0) + 1 AS "nextAttempt"
      FROM "AssessmentAttempt"
      WHERE "enrollmentId" = ${enrollment.enrollmentId}
      FOR UPDATE
    `);
    const attemptNumber = Number(attemptRows[0]?.nextAttempt ?? 1);
    const attemptId = randomUUID();
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "AssessmentAttempt" (
        "id", "enrollmentId", "learnerId", "courseId", "attemptNumber", "status",
        "answers", "score", "passingScore", "startedAt", "submittedAt", "metadata",
        "createdAt", "updatedAt"
      ) VALUES (
        ${attemptId}, ${enrollment.enrollmentId}, ${learner.id}, ${enrollment.courseId},
        ${attemptNumber}, ${passed ? "PASSED" : "FAILED"},
        ${JSON.stringify(input.answers)}::jsonb, ${score}, ${enrollment.passingScore},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        ${JSON.stringify({ questionCount: questions.length, correctCount: correct })}::jsonb,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);

    let certificateNumber: string | null = null;
    if (passed) {
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "CourseEnrollment"
        SET "status" = 'COMPLETED', "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP),
            "lastAccessedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${enrollment.enrollmentId}
      `);
      if (enrollment.certificateIssued) {
        certificateNumber = await issueCertificate(transaction, enrollment, learner, score);
      }
    }

    return {
      attemptId,
      attemptNumber,
      score,
      passingScore: enrollment.passingScore,
      passed,
      certificateNumber,
      certificateUrl: certificateNumber
        ? `/learner/certificates/${encodeURIComponent(certificateNumber)}`
        : null,
      results,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function issueCertificate(
  transaction: TransactionClient,
  enrollment: EnrollmentRow,
  learner: LearnerRow,
  assessmentScore: number,
): Promise<string> {
  const existing = await transaction.$queryRaw<Array<{ certificateNumber: string }>>(Prisma.sql`
    SELECT "certificateNumber"
    FROM "CourseCertificate"
    WHERE "enrollmentId" = ${enrollment.enrollmentId} AND "status" = 'ACTIVE'
    LIMIT 1
  `);
  if (existing[0]) return existing[0].certificateNumber;

  const learnerName = learner.displayName?.trim() || learner.email || "Obserra Academy Learner";
  const metadata = jsonObject(enrollment.policyMetadata);
  const trainingHours = typeof metadata.trainingHours === "string"
    ? metadata.trainingHours
    : typeof metadata.duration === "string"
      ? metadata.duration
      : "Course duration on record";
  const certificateNumber = `OBS-${enrollment.courseSlug.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const issuedAt = new Date();
  const verificationHash = signCertificate({
    certificateNumber,
    clerkUserId: learner.clerkUserId,
    courseSlug: enrollment.courseSlug,
    issuedAt: issuedAt.toISOString(),
    assessmentScore,
  });

  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "CourseCertificate" (
      "id", "certificateNumber", "enrollmentId", "learnerId", "courseId", "status",
      "learnerName", "courseTitle", "trainingHours", "assessmentScore", "issuedAt",
      "verificationHash", "metadata", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${certificateNumber}, ${enrollment.enrollmentId}, ${learner.id},
      ${enrollment.courseId}, 'ACTIVE', ${learnerName}, ${enrollment.courseTitle},
      ${trainingHours}, ${assessmentScore}, ${issuedAt}, ${verificationHash},
      ${JSON.stringify({
        issuer: CERTIFICATE_ISSUER,
        title: enrollment.certificateTitle,
        credentialDisclaimer: enrollment.credentialDisclaimer,
        courseVersion: enrollment.courseVersion,
        signatureAlgorithm: "HMAC-SHA-256",
      })}::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  return certificateNumber;
}

export async function learnerCertificate(clerkUserId: string, certificateNumber: string) {
  const normalized = certificateNumber.trim().toUpperCase();
  if (!CERTIFICATE_PATTERN.test(normalized)) {
    throw new LearnerDeliveryError("Certificate identifier is invalid.", 400, "INVALID_CERTIFICATE_ID");
  }
  const rows = await prisma.$queryRaw<CertificateRow[]>(Prisma.sql`
    SELECT
      certificate."certificateNumber",
      certificate."learnerId",
      learner."clerkUserId",
      certificate."learnerName",
      certificate."courseId",
      course."slug" AS "courseSlug",
      certificate."courseTitle",
      certificate."trainingHours",
      certificate."assessmentScore",
      certificate."status",
      certificate."issuedAt",
      certificate."revokedAt",
      certificate."verificationHash",
      certificate."metadata"
    FROM "CourseCertificate" certificate
    JOIN "LearnerAccount" learner ON learner."id" = certificate."learnerId"
    JOIN "Course" course ON course."id" = certificate."courseId"
    WHERE certificate."certificateNumber" = ${normalized}
      AND learner."clerkUserId" = ${clerkUserId}
    LIMIT 1
  `);
  const certificate = rows[0];
  if (!certificate) {
    throw new LearnerDeliveryError("Certificate was not found.", 404, "CERTIFICATE_NOT_FOUND");
  }
  return publicCertificate(certificate);
}

export async function verifyPublicCertificate(certificateNumber: string) {
  const normalized = certificateNumber.trim().toUpperCase();
  if (!CERTIFICATE_PATTERN.test(normalized)) return null;
  const rows = await prisma.$queryRaw<CertificateRow[]>(Prisma.sql`
    SELECT
      certificate."certificateNumber",
      certificate."learnerId",
      learner."clerkUserId",
      certificate."learnerName",
      certificate."courseId",
      course."slug" AS "courseSlug",
      certificate."courseTitle",
      certificate."trainingHours",
      certificate."assessmentScore",
      certificate."status",
      certificate."issuedAt",
      certificate."revokedAt",
      certificate."verificationHash",
      certificate."metadata"
    FROM "CourseCertificate" certificate
    JOIN "LearnerAccount" learner ON learner."id" = certificate."learnerId"
    JOIN "Course" course ON course."id" = certificate."courseId"
    WHERE certificate."certificateNumber" = ${normalized}
    LIMIT 1
  `);
  const certificate = rows[0];
  if (!certificate || certificate.status !== "ACTIVE" || !verifyCertificateHash(certificate)) return null;
  const projected = publicCertificate(certificate);
  return {
    valid: true as const,
    certificateNumber: projected.certificateNumber,
    learnerName: projected.learnerName,
    courseTitle: projected.courseTitle,
    trainingHours: projected.trainingHours,
    assessmentScore: projected.assessmentScore,
    issuedAt: projected.issuedAt,
    issuer: projected.issuer,
    title: projected.title,
  };
}

function publicCertificate(certificate: CertificateRow) {
  const metadata = jsonObject(certificate.metadata);
  return {
    certificateNumber: certificate.certificateNumber,
    learnerName: certificate.learnerName,
    courseSlug: certificate.courseSlug,
    courseTitle: certificate.courseTitle,
    trainingHours: certificate.trainingHours,
    assessmentScore: certificate.assessmentScore,
    status: certificate.status,
    issuedAt: certificate.issuedAt.toISOString(),
    revokedAt: isoDate(certificate.revokedAt),
    issuer: typeof metadata.issuer === "string" ? metadata.issuer : CERTIFICATE_ISSUER,
    title: typeof metadata.title === "string" ? metadata.title : "Certificate of Course Completion",
    credentialDisclaimer: typeof metadata.credentialDisclaimer === "string"
      ? metadata.credentialDisclaimer
      : "This is a proprietary course completion record, not licensure or third-party certification.",
    signatureAlgorithm: typeof metadata.signatureAlgorithm === "string"
      ? metadata.signatureAlgorithm
      : "HMAC-SHA-256",
    valid: certificate.status === "ACTIVE" && verifyCertificateHash(certificate),
    verificationUrl: `/certificates/verify/${encodeURIComponent(certificate.certificateNumber)}`,
  };
}

export async function entitledAsset(clerkUserId: string, assetId: string) {
  const id = assertSafeText(assetId, "assetId", 256);
  const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
    SELECT
      asset."id", asset."courseId", asset."lessonId", asset."assetKey", asset."assetType",
      asset."title", asset."storageKey", asset."inlineContent", asset."mimeType",
      asset."availabilityStatus", asset."isDownloadable", asset."position",
      asset."checksumSha256", asset."durationSeconds", asset."metadata"
    FROM "CourseDeliveryAsset" asset
    JOIN "CourseEntitlement" entitlement
      ON entitlement."courseId" = asset."courseId"
      AND entitlement."status" = 'ACTIVE'
      AND (entitlement."expiresAt" IS NULL OR entitlement."expiresAt" > CURRENT_TIMESTAMP)
    JOIN "LearnerAccount" learner ON learner."id" = entitlement."learnerId"
    WHERE asset."id" = ${id}
      AND asset."availabilityStatus" = 'READY'
      AND learner."clerkUserId" = ${clerkUserId}
    LIMIT 1
  `);
  const asset = rows[0];
  if (!asset) {
    throw new LearnerDeliveryError("Protected course asset was not found.", 404, "ASSET_NOT_FOUND");
  }
  return asset;
}
