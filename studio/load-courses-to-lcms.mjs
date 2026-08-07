import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const releasesRoot = path.join(root, "releases");
const dryRun = process.argv.includes("--dry-run");
const uploadAssets = process.argv.includes("--upload-assets");
let prisma;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function storagePath(storageKey) {
  return storageKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function storageConfiguration() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to publish Academy storage assets");
  }
  return { url, serviceRole };
}

async function uploadStorageObject(bucket, storageKey, sourcePath, mimeType) {
  const { url, serviceRole } = storageConfiguration();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath(storageKey)}`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": mimeType,
      "x-upsert": "true",
    },
    body: fs.readFileSync(sourcePath),
  });
  if (!response.ok) {
    throw new Error(`Storage upload failed for ${bucket}/${storageKey}: ${response.status} ${await response.text()}`);
  }
}

async function verifyStorageObject(bucket, storageKey) {
  const { url, serviceRole } = storageConfiguration();
  const response = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${storagePath(storageKey)}`, {
    method: "HEAD",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Approved storage object is unavailable: ${bucket}/${storageKey}`);
  }
}

function manifestPaths() {
  if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(coursesRoot, entry.name, "course-manifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath));
}

function validateManifest(manifest, manifestPath) {
  const errors = [];
  if (!manifest?.course?.id) errors.push("course.id is required");
  if (!manifest?.course?.title) errors.push("course.title is required");
  if (!Array.isArray(manifest?.course?.modules) || manifest.course.modules.length === 0) {
    errors.push("course.modules must contain at least one module");
  }
  for (const [index, module] of (manifest?.course?.modules ?? []).entries()) {
    if (!module.id) errors.push(`course.modules[${index}].id is required`);
    if (!module.title) errors.push(`course.modules[${index}].title is required`);
  }
  if (errors.length) throw new Error(`${manifestPath}: ${errors.join("; ")}`);
  assertBrandAndTags(manifest, manifestPath);
}

function releaseEntries() {
  if (!fs.existsSync(releasesRoot)) return [];
  const entries = [];
  for (const directory of fs.readdirSync(releasesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const releaseDir = path.join(releasesRoot, directory.name, "FINAL");
    const recordPath = path.join(releaseDir, "release-record.json");
    const manifestPath = path.join(releaseDir, "course-manifest.json");
    if (!fs.existsSync(recordPath) || !fs.existsSync(manifestPath)) continue;
    const record = readJson(recordPath);
    const manifest = readJson(manifestPath);
    if (record.learnerDeliveryReady !== true) continue;
    if (record.productionRelease !== true || manifest.release?.publishToAcademy !== true) continue;
    if (!["approved", "published"].includes(String(manifest.release?.status ?? "").toLowerCase())) continue;
    entries.push({ releaseDir, recordPath, record, manifestPath, manifest });
  }
  return entries.sort((left, right) => left.manifest.course.id.localeCompare(right.manifest.course.id));
}

function approvedPackage(entry) {
  const packagePath = path.join(entry.releaseDir, "course-package.json");
  if (!fs.existsSync(packagePath)) throw new Error(`${entry.manifest.course.id}: approved course-package.json is missing`);
  const envelope = readJson(packagePath);
  const status = String(envelope.reviewStatus ?? "").toLowerCase();
  if (!["approved", "owner-approved", "final"].includes(status)) {
    throw new Error(`${entry.manifest.course.id}: authored package status is not approved`);
  }
  if (envelope.courseId !== entry.manifest.course.id || !envelope.content) {
    throw new Error(`${entry.manifest.course.id}: authored package does not match the release`);
  }
  return envelope;
}

function approvedMedia(entry) {
  const mediaPath = path.join(entry.releaseDir, "approved-media.json");
  if (!fs.existsSync(mediaPath)) throw new Error(`${entry.manifest.course.id}: approved-media.json is missing`);
  const media = readJson(mediaPath);
  if (media.courseId !== entry.manifest.course.id || media.status !== "approved" || !Array.isArray(media.assets)) {
    throw new Error(`${entry.manifest.course.id}: approved media manifest is invalid`);
  }
  return media;
}

function sourceFile(entry, sourcePath) {
  if (!sourcePath) return null;
  const releaseCandidate = path.resolve(entry.releaseDir, sourcePath);
  const courseCandidate = path.resolve(coursesRoot, entry.manifest.course.id, sourcePath);
  const allowedRoots = [path.resolve(entry.releaseDir), path.resolve(coursesRoot, entry.manifest.course.id)];
  for (const candidate of [releaseCandidate, courseCandidate]) {
    if (allowedRoots.some((allowed) => candidate === allowed || candidate.startsWith(`${allowed}${path.sep}`)) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`${entry.manifest.course.id}: approved media source file is missing or outside the course boundary: ${sourcePath}`);
}

function moduleContent(authoredModule, manifestModule) {
  if (!authoredModule || authoredModule.id !== manifestModule.id) {
    throw new Error(`Approved authored content is missing for module ${manifestModule.id}`);
  }
  const scenario = authoredModule.scenario ?? {};
  const checks = Array.isArray(authoredModule.knowledgeChecks) ? authoredModule.knowledgeChecks : [];
  const slides = Array.isArray(authoredModule.slideNarrative) ? authoredModule.slideNarrative : [];

  return {
    schemaVersion: "1.0",
    manifestModuleId: manifestModule.id,
    duration: manifestModule.duration ?? null,
    format: manifestModule.format ?? null,
    learner: {
      learningObjectives: authoredModule.learningObjectives ?? [],
      openingContext: authoredModule.openingContext ?? "",
      lessonNarrative: authoredModule.lessonNarrative ?? "",
      keyConcepts: authoredModule.keyConcepts ?? [],
      executiveExample: authoredModule.executiveExample ?? "",
      operationalExample: authoredModule.operationalExample ?? "",
      scenario: {
        situation: scenario.situation ?? "",
        evidence: scenario.evidence ?? [],
        decisionPrompt: scenario.decisionPrompt ?? "",
      },
      exercise: authoredModule.exercise ?? {},
      knowledgeChecks: checks.map((check) => ({ question: check.question, options: check.options })),
      slides: slides.map((slide) => ({
        title: slide.title,
        content: slide.content,
        visualDirection: slide.visualDirection,
      })),
      videoScript: authoredModule.videoScript ?? {},
      accessibilityNotes: authoredModule.accessibilityNotes ?? [],
    },
    instructor: {
      scenarioResolution: {
        recommendedApproach: scenario.recommendedApproach ?? "",
        debrief: scenario.debrief ?? "",
      },
      knowledgeChecks: checks,
      slideSpeakerNotes: slides.map((slide) => ({ title: slide.title, speakerNotes: slide.speakerNotes })),
      sourcePlaceholders: authoredModule.sourcePlaceholders ?? [],
    },
  };
}

function artifactDefaults(kind) {
  if (["video", "captions"].includes(kind)) return { bucket: "academy-videos", downloadable: false };
  if (kind === "certificate-template") return { bucket: "academy-certificates", downloadable: false };
  return { bucket: "academy-materials", downloadable: true };
}

async function createPrismaClient() {
  const module = await import("@prisma/client");
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (!PrismaClient) throw new Error("PrismaClient is unavailable. Run `npm run db:generate` before a database load.");
  return new PrismaClient();
}

async function resolveOrganization() {
  const clerkOrganizationId = process.env.STUDIO_SEED_CLERK_ORG_ID ?? process.env.STUDIO_OWNER_ORGANIZATION_ID;
  if (!clerkOrganizationId) {
    throw new Error("STUDIO_SEED_CLERK_ORG_ID or STUDIO_OWNER_ORGANIZATION_ID is required to load courses");
  }
  const slug = clerkOrganizationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    update: { active: true },
    create: {
      clerkOrganizationId,
      name: process.env.STUDIO_OWNER_ORGANIZATION_NAME ?? "Obserra Academy",
      slug,
      active: true,
    },
  });
}

async function insertArtifact(transaction, artifact) {
  await transaction.$executeRaw`
    insert into public.academy_course_artifacts (
      course_id,
      lesson_id,
      kind,
      title,
      body,
      bucket,
      storage_key,
      mime_type,
      visibility,
      downloadable,
      checksum_sha256,
      metadata,
      updated_at
    ) values (
      ${artifact.courseId},
      ${artifact.lessonId},
      ${artifact.kind},
      ${artifact.title},
      ${artifact.body},
      ${artifact.bucket},
      ${artifact.storageKey},
      ${artifact.mimeType},
      ${artifact.visibility},
      ${artifact.downloadable},
      ${artifact.checksum},
      ${JSON.stringify(artifact.metadata ?? {})}::jsonb,
      now()
    )
  `;
}

async function prepareMediaAssets(entry, lessonByModuleId) {
  const media = approvedMedia(entry);
  const prepared = [];
  for (const asset of media.assets) {
    if (!["video", "captions", "transcript", "slide-deck", "resource"].includes(asset.kind)) {
      throw new Error(`${entry.manifest.course.id}: unsupported approved media kind ${asset.kind}`);
    }
    const lesson = lessonByModuleId.get(asset.moduleId);
    if (!lesson) throw new Error(`${entry.manifest.course.id}: media references unknown module ${asset.moduleId}`);
    const defaults = artifactDefaults(asset.kind);
    const bucket = asset.bucket ?? defaults.bucket;
    const storageKey = String(asset.storageKey ?? "").trim();
    if (!storageKey) throw new Error(`${entry.manifest.course.id}: ${asset.kind} storageKey is required`);
    const sourcePath = sourceFile(entry, asset.sourcePath);
    if (uploadAssets) {
      if (!sourcePath) throw new Error(`${entry.manifest.course.id}: ${asset.kind} sourcePath is required for upload`);
      await uploadStorageObject(bucket, storageKey, sourcePath, asset.mimeType ?? "application/octet-stream");
    } else {
      await verifyStorageObject(bucket, storageKey);
    }
    const checksum = asset.checksumSha256 ?? (sourcePath ? sha256File(sourcePath) : null);
    if (!checksum) throw new Error(`${entry.manifest.course.id}: ${asset.kind} checksum is required`);

    prepared.push({
      lessonId: lesson.id,
      kind: asset.kind,
      title: asset.title ?? `${lesson.title} ${asset.kind}`,
      body: null,
      bucket,
      storageKey,
      mimeType: asset.mimeType ?? null,
      visibility: "LEARNER",
      downloadable: asset.downloadable ?? defaults.downloadable,
      checksum,
      metadata: { moduleId: asset.moduleId, ...(asset.metadata ?? {}) },
    });
  }
  return prepared;
}

async function loadRelease(organizationId, entry) {
  const manifest = entry.manifest;
  const course = manifest.course;
  const authoredEnvelope = approvedPackage(entry);
  const authored = authoredEnvelope.content;
  const authoredModules = new Map((authored.modules ?? []).map((module) => [module.id, module]));
  const finalAssessment = Array.isArray(authored.finalAssessment) ? authored.finalAssessment : [];
  const assessmentBank = readJson(path.join(entry.releaseDir, "assessment-bank.json"));
  if (finalAssessment.length < 1) throw new Error(`${course.id}: approved authored final assessment is missing`);
  if (!Array.isArray(assessmentBank.questions) || assessmentBank.questions.length !== finalAssessment.length) {
    throw new Error(`${course.id}: approved assessment bank does not match authored final assessment`);
  }

  const learnerGuidePath = path.join(entry.releaseDir, "learner-guide.md");
  const workbookPath = path.join(entry.releaseDir, "workbook.md");
  const certificatePath = path.join(entry.releaseDir, "certificate-template.json");
  for (const required of [learnerGuidePath, workbookPath, certificatePath]) {
    if (!fs.existsSync(required)) throw new Error(`${course.id}: required learner artifact is missing: ${path.basename(required)}`);
  }

  return prisma.$transaction(async (transaction) => {
    const record = await transaction.course.upsert({
      where: { organizationId_slug: { organizationId, slug: course.id } },
      update: {
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: "PUBLISHED",
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: officialBrand.studioName,
      },
      create: {
        organizationId,
        slug: course.id,
        title: course.title,
        summary: `${course.description ?? ""}\n\n${officialBrand.disclaimer.shortText}`.trim(),
        status: "PUBLISHED",
        version: Math.max(1, Number.parseInt(String(manifest.release?.version ?? "1").split(".")[0], 10) || 1),
        productionOwner: officialBrand.studioName,
      },
    });

    await transaction.$executeRaw`delete from public.academy_course_artifacts where course_id = ${record.id}`;
    await transaction.$executeRaw`delete from public.academy_delivery_releases where course_id = ${record.id}`;
    await transaction.lesson.deleteMany({ where: { courseId: record.id } });

    const lessonByModuleId = new Map();
    for (const [index, manifestModule] of course.modules.entries()) {
      const authoredModule = authoredModules.get(manifestModule.id);
      const lesson = await transaction.lesson.create({
        data: {
          courseId: record.id,
          title: manifestModule.title,
          position: index + 1,
          objective: manifestModule.description ?? null,
          content: moduleContent(authoredModule, manifestModule),
        },
      });
      lessonByModuleId.set(manifestModule.id, lesson);

      const knowledgeChecks = Array.isArray(authoredModule?.knowledgeChecks) ? authoredModule.knowledgeChecks : [];
      const requiredCheck = knowledgeChecks[0];
      if (!requiredCheck || !Array.isArray(requiredCheck.options) || !Number.isInteger(requiredCheck.correctIndex)) {
        throw new Error(`${course.id}: module ${manifestModule.id} requires a valid knowledge check`);
      }
      await transaction.assessment.create({
        data: {
          lessonId: lesson.id,
          kind: "knowledge-check",
          prompt: requiredCheck.question,
          options: requiredCheck.options,
          answerKey: { correctIndex: requiredCheck.correctIndex },
          rationale: requiredCheck.rationale ?? null,
        },
      });
    }

    const assessmentLesson = lessonByModuleId.get(finalAssessment[0]?.moduleId) ?? [...lessonByModuleId.values()][0];
    for (const question of finalAssessment) {
      if (!question.question || !Array.isArray(question.options) || !Number.isInteger(question.correctIndex)) {
        throw new Error(`${course.id}: final assessment contains an invalid question`);
      }
      const targetLesson = lessonByModuleId.get(question.moduleId) ?? assessmentLesson;
      await transaction.assessment.create({
        data: {
          lessonId: targetLesson.id,
          kind: "final",
          prompt: question.question,
          options: question.options,
          answerKey: { correctIndex: question.correctIndex },
          rationale: question.rationale ?? null,
        },
      });
    }

    const mediaAssets = await prepareMediaAssets(entry, lessonByModuleId);
    for (const asset of mediaAssets) {
      await insertArtifact(transaction, { courseId: record.id, ...asset });
    }

    const materialDefinitions = [
      { kind: "learner-guide", title: `${course.title} Learner Guide`, filePath: learnerGuidePath },
      { kind: "workbook", title: `${course.title} Learner Workbook`, filePath: workbookPath },
    ];
    for (const material of materialDefinitions) {
      const body = fs.readFileSync(material.filePath, "utf8");
      const storageKey = `${course.id}/${manifest.release.version}/${path.basename(material.filePath)}`;
      if (uploadAssets) await uploadStorageObject("academy-materials", storageKey, material.filePath, "text/markdown");
      await insertArtifact(transaction, {
        courseId: record.id,
        lessonId: null,
        kind: material.kind,
        title: material.title,
        body,
        bucket: uploadAssets ? "academy-materials" : null,
        storageKey: uploadAssets ? storageKey : null,
        mimeType: "text/markdown",
        visibility: "LEARNER",
        downloadable: true,
        checksum: sha256File(material.filePath),
        metadata: { releaseVersion: manifest.release.version },
      });
    }

    const certificateBody = fs.readFileSync(certificatePath, "utf8");
    const certificateStorageKey = `${course.id}/${manifest.release.version}/certificate-template.json`;
    if (uploadAssets) {
      await uploadStorageObject("academy-certificates", certificateStorageKey, certificatePath, "application/json");
    }
    await insertArtifact(transaction, {
      courseId: record.id,
      lessonId: null,
      kind: "certificate-template",
      title: `${course.title} Certificate Template`,
      body: certificateBody,
      bucket: uploadAssets ? "academy-certificates" : null,
      storageKey: uploadAssets ? certificateStorageKey : null,
      mimeType: "application/json",
      visibility: "LEARNER",
      downloadable: false,
      checksum: sha256File(certificatePath),
      metadata: { releaseVersion: manifest.release.version },
    });

    const videoCount = mediaAssets.filter((asset) => asset.kind === "video").length;
    const releaseVersion = String(manifest.release.version);
    await transaction.release.upsert({
      where: { courseId_version: { courseId: record.id, version: releaseVersion } },
      update: {
        status: "PUBLISHED",
        packageUrl: `supabase://academy-delivery/${course.id}/${releaseVersion}`,
        approvedBy: entry.record.approvedBy ?? "governed-release-pipeline",
        approvedAt: entry.record.approvedAt ? new Date(entry.record.approvedAt) : new Date(),
        publishedAt: new Date(),
      },
      create: {
        courseId: record.id,
        version: releaseVersion,
        status: "PUBLISHED",
        packageUrl: `supabase://academy-delivery/${course.id}/${releaseVersion}`,
        approvedBy: entry.record.approvedBy ?? "governed-release-pipeline",
        approvedAt: entry.record.approvedAt ? new Date(entry.record.approvedAt) : new Date(),
        publishedAt: new Date(),
      },
    });

    const publishedAt = new Date();
    await transaction.$executeRaw`
      insert into public.academy_delivery_releases (
        course_id,
        course_slug,
        version,
        status,
        manifest,
        content_hash,
        lesson_count,
        assessment_count,
        video_count,
        material_count,
        certificate_template_available,
        published_at,
        updated_at
      ) values (
        ${record.id},
        ${course.id},
        ${releaseVersion},
        'PUBLISHED',
        ${JSON.stringify(manifest)}::jsonb,
        ${entry.record.contentHash},
        ${course.modules.length},
        ${finalAssessment.length},
        ${videoCount},
        ${materialDefinitions.length},
        true,
        ${publishedAt},
        now()
      )
    `;

    await transaction.auditEvent.create({
      data: {
        organizationId,
        actorType: "service",
        actorId: "academy-release-loader",
        action: "academy.release.publish",
        resourceType: "Course",
        resourceId: record.id,
        outcome: "success",
        metadata: {
          slug: course.id,
          releaseVersion,
          lessonCount: course.modules.length,
          assessmentCount: finalAssessment.length,
          videoCount,
          materialCount: materialDefinitions.length,
          uploadAssets,
          contentHash: entry.record.contentHash,
          sourceRelease: path.relative(root, entry.releaseDir).replaceAll("\\", "/"),
        },
      },
    });

    return {
      id: record.id,
      slug: record.slug,
      lessons: course.modules.length,
      assessments: finalAssessment.length,
      videos: videoCount,
      materials: materialDefinitions.length,
      version: releaseVersion,
    };
  });
}

const manifests = manifestPaths().map((manifestPath) => ({ manifestPath, manifest: readJson(manifestPath) }));
for (const item of manifests) validateManifest(item.manifest, item.manifestPath);
const releases = releaseEntries();

for (const entry of releases) {
  approvedPackage(entry);
  approvedMedia(entry);
}

if (dryRun) {
  console.log(`[Academy Studio] Validated ${manifests.length} course manifest(s).`);
  console.log(`[Academy Studio] Governed learner delivery dry-run found ${releases.length} publishable FINAL release(s).`);
  for (const entry of releases) {
    console.log(`- ${entry.manifest.course.id}: version ${entry.manifest.release.version}, ${entry.record.inventory.lessonCount} lessons, ${entry.record.inventory.videoCount} videos`);
  }
  if (releases.length === 0) {
    console.log("[Academy Studio] No course was loaded because no approved, learner-delivery-ready FINAL release exists.");
  }
  process.exit(0);
}

try {
  prisma = await createPrismaClient();
  const organization = await resolveOrganization();
  const results = [];
  for (const entry of releases) results.push(await loadRelease(organization.id, entry));
  console.log(`[Academy Studio] Published ${results.length} governed learner release(s) into organization ${organization.clerkOrganizationId}.`);
  for (const result of results) {
    console.log(`- ${result.slug}@${result.version}: ${result.lessons} lessons, ${result.assessments} assessment questions, ${result.videos} videos, ${result.materials} materials`);
  }
} finally {
  if (prisma) await prisma.$disconnect();
}
