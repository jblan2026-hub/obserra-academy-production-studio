export const artifactKinds = [
  "course-outline",
  "lesson-script",
  "slide-deck",
  "visual-brief",
  "narration-audio",
  "training-video",
  "captions",
  "assessment-bank",
  "learner-guide",
  "instructor-guide",
];

export function assertGenerationRequest(request) {
  if (!request || typeof request !== "object") throw new Error("Generation request is required");
  if (!request.courseId) throw new Error("courseId is required");
  if (!artifactKinds.includes(request.artifactKind)) throw new Error(`Unsupported artifact kind: ${request.artifactKind}`);
  if (!request.outputDirectory) throw new Error("outputDirectory is required");
  return request;
}

export function generationResult({ provider, artifactKind, status, files = [], externalId = null, metadata = {} }) {
  return {
    provider,
    artifactKind,
    status,
    files,
    externalId,
    metadata,
    generatedAt: new Date().toISOString(),
  };
}
