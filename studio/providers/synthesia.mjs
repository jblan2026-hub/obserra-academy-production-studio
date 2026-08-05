import fs from "node:fs";
import path from "node:path";
import { assertGenerationRequest, generationResult } from "./provider-contract.mjs";

export async function generateWithSynthesia(input) {
  const request = assertGenerationRequest(input);
  const apiKey = process.env.SYNTHESIA_API_KEY;
  const templateId = process.env.SYNTHESIA_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    return generationResult({ provider: "synthesia", artifactKind: request.artifactKind, status: "configuration-required" });
  }

  const response = await fetch("https://api.synthesia.io/v2/videos", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      test: process.env.SYNTHESIA_TEST_MODE === "true",
      templateId,
      templateData: {
        course_title: request.courseTitle,
        lesson_title: request.lessonTitle,
        narration: request.script,
      },
      title: `${request.courseTitle} - ${request.lessonTitle}`,
      visibility: "private",
    }),
  });

  if (!response.ok) throw new Error(`Synthesia request failed with status ${response.status}`);
  const payload = await response.json();
  fs.mkdirSync(request.outputDirectory, { recursive: true });
  const jobPath = path.join(request.outputDirectory, `${request.lessonId}.synthesia-job.json`);
  fs.writeFileSync(jobPath, `${JSON.stringify(payload, null, 2)}\n`);

  return generationResult({
    provider: "synthesia",
    artifactKind: request.artifactKind,
    status: "submitted",
    files: [jobPath],
    externalId: payload.id ?? null,
    metadata: { templateId },
  });
}
