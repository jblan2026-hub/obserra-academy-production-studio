-- Protected post-purchase learner delivery plane.
-- Course authoring remains governed by Course/Lesson/Assessment. These tables
-- establish durable commerce, entitlement, progress, media, and certificate state.

CREATE TABLE "LearnerAccount" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceEvent_status_check" CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'REJECTED'))
);

CREATE TABLE "CoursePurchase" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "learnerId" TEXT,
    "provider" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "purchaserReference" TEXT,
    "purchaserEmail" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoursePurchase_amount_check" CHECK ("amountCents" >= 0),
    CONSTRAINT "CoursePurchase_status_check" CHECK ("status" IN ('PAID', 'PAID_PENDING_CLAIM', 'REFUNDED', 'DISPUTED', 'CANCELED'))
);

CREATE TABLE "CourseEntitlement" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseEntitlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseEntitlement_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
);

CREATE TABLE "CourseEnrollment" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "currentLessonId" TEXT,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "lastAccessedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseEnrollment_status_check" CHECK ("status" IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SUSPENDED'))
);

CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonProgress_status_check" CHECK ("status" IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT "LessonProgress_percent_check" CHECK ("progressPercent" BETWEEN 0 AND 100),
    CONSTRAINT "LessonProgress_position_check" CHECK ("lastPositionSeconds" >= 0)
);

CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER,
    "passingScore" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssessmentAttempt_number_check" CHECK ("attemptNumber" > 0),
    CONSTRAINT "AssessmentAttempt_status_check" CHECK ("status" IN ('IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED', 'INVALIDATED')),
    CONSTRAINT "AssessmentAttempt_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
    CONSTRAINT "AssessmentAttempt_passing_check" CHECK ("passingScore" BETWEEN 1 AND 100)
);

CREATE TABLE "CourseCertificate" (
    "id" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "learnerName" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "trainingHours" TEXT NOT NULL,
    "assessmentScore" INTEGER NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,
    "verificationHash" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseCertificate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseCertificate_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT "CourseCertificate_score_check" CHECK ("assessmentScore" BETWEEN 0 AND 100)
);

CREATE TABLE "CourseDeliveryPolicy" (
    "courseId" TEXT NOT NULL,
    "allLessonsRequired" BOOLEAN NOT NULL DEFAULT TRUE,
    "assessmentRequired" BOOLEAN NOT NULL DEFAULT TRUE,
    "passingScore" INTEGER NOT NULL DEFAULT 80,
    "assessmentDurationMinutes" INTEGER,
    "certificateIssued" BOOLEAN NOT NULL DEFAULT TRUE,
    "certificateTitle" TEXT NOT NULL DEFAULT 'Certificate of Course Completion',
    "credentialDisclaimer" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseDeliveryPolicy_pkey" PRIMARY KEY ("courseId"),
    CONSTRAINT "CourseDeliveryPolicy_score_check" CHECK ("passingScore" BETWEEN 1 AND 100),
    CONSTRAINT "CourseDeliveryPolicy_duration_check" CHECK ("assessmentDurationMinutes" IS NULL OR "assessmentDurationMinutes" > 0)
);

CREATE TABLE "CourseDeliveryAsset" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "assetKey" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT,
    "inlineContent" TEXT,
    "mimeType" TEXT,
    "availabilityStatus" TEXT NOT NULL DEFAULT 'READY',
    "isDownloadable" BOOLEAN NOT NULL DEFAULT FALSE,
    "protected" BOOLEAN NOT NULL DEFAULT TRUE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "checksumSha256" TEXT,
    "durationSeconds" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseDeliveryAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseDeliveryAsset_availability_check" CHECK ("availabilityStatus" IN ('PENDING', 'READY', 'WITHHELD', 'RETIRED')),
    CONSTRAINT "CourseDeliveryAsset_position_check" CHECK ("position" >= 0),
    CONSTRAINT "CourseDeliveryAsset_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0),
    CONSTRAINT "CourseDeliveryAsset_content_check" CHECK ("storageKey" IS NOT NULL OR "inlineContent" IS NOT NULL)
);

CREATE UNIQUE INDEX "LearnerAccount_clerkUserId_key" ON "LearnerAccount"("clerkUserId");
CREATE UNIQUE INDEX "CommerceEvent_providerEventId_key" ON "CommerceEvent"("providerEventId");
CREATE INDEX "CommerceEvent_status_createdAt_idx" ON "CommerceEvent"("status", "createdAt");
CREATE UNIQUE INDEX "CoursePurchase_checkoutSessionId_key" ON "CoursePurchase"("checkoutSessionId");
CREATE INDEX "CoursePurchase_learnerId_status_idx" ON "CoursePurchase"("learnerId", "status");
CREATE INDEX "CoursePurchase_courseId_status_idx" ON "CoursePurchase"("courseId", "status");
CREATE UNIQUE INDEX "CourseEntitlement_learnerId_courseId_key" ON "CourseEntitlement"("learnerId", "courseId");
CREATE INDEX "CourseEntitlement_courseId_status_idx" ON "CourseEntitlement"("courseId", "status");
CREATE UNIQUE INDEX "CourseEnrollment_learnerId_courseId_key" ON "CourseEnrollment"("learnerId", "courseId");
CREATE UNIQUE INDEX "CourseEnrollment_entitlementId_key" ON "CourseEnrollment"("entitlementId");
CREATE INDEX "CourseEnrollment_status_lastAccessedAt_idx" ON "CourseEnrollment"("status", "lastAccessedAt");
CREATE UNIQUE INDEX "LessonProgress_enrollmentId_lessonId_key" ON "LessonProgress"("enrollmentId", "lessonId");
CREATE INDEX "LessonProgress_lessonId_status_idx" ON "LessonProgress"("lessonId", "status");
CREATE UNIQUE INDEX "AssessmentAttempt_enrollmentId_attemptNumber_key" ON "AssessmentAttempt"("enrollmentId", "attemptNumber");
CREATE INDEX "AssessmentAttempt_courseId_status_idx" ON "AssessmentAttempt"("courseId", "status");
CREATE UNIQUE INDEX "CourseCertificate_certificateNumber_key" ON "CourseCertificate"("certificateNumber");
CREATE UNIQUE INDEX "CourseCertificate_enrollmentId_key" ON "CourseCertificate"("enrollmentId");
CREATE INDEX "CourseCertificate_courseId_status_idx" ON "CourseCertificate"("courseId", "status");
CREATE UNIQUE INDEX "CourseDeliveryAsset_courseId_assetKey_key" ON "CourseDeliveryAsset"("courseId", "assetKey");
CREATE INDEX "CourseDeliveryAsset_lessonId_position_idx" ON "CourseDeliveryAsset"("lessonId", "position");
CREATE INDEX "CourseDeliveryAsset_courseId_assetType_idx" ON "CourseDeliveryAsset"("courseId", "assetType");

ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseEntitlement" ADD CONSTRAINT "CourseEntitlement_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseEntitlement" ADD CONSTRAINT "CourseEntitlement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseEntitlement" ADD CONSTRAINT "CourseEntitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CoursePurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "CourseEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_currentLessonId_fkey" FOREIGN KEY ("currentLessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseCertificate" ADD CONSTRAINT "CourseCertificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseCertificate" ADD CONSTRAINT "CourseCertificate_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseCertificate" ADD CONSTRAINT "CourseCertificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDeliveryPolicy" ADD CONSTRAINT "CourseDeliveryPolicy_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseDeliveryAsset" ADD CONSTRAINT "CourseDeliveryAsset_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseDeliveryAsset" ADD CONSTRAINT "CourseDeliveryAsset_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
