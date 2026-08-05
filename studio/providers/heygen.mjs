import fs from "node:fs";
import path from "node:path";
import { assertGenerationRequest, generationResult } from "./provider-contract.mjs";

export async function generateWithHeyGen(input) {
  const request = assertGenerationRequest(input);
  const apiKey = process.env.HEYGEN_API_KEY;
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  if (!apiKey || !avatarId || !voiceId) {
    return generationResult({ provider: "heygen", artifactKind: request.artifactKind, status: "configuration-required" });
  }

  const response = await fetch("https://api.heygen.com/v3/videos", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `${request.courseTitle} - ${request.lessonTitle}`,
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId },
          voice: { type: "text", voice_id: voiceId, input_text: request.script },
          background: { type: "color", value: "#071523" },
        },
      ],
      dimension: { width: 1920, height: 1080 },
      caption: true,
    }),
  });

  if (!response.ok) throw new Error(`HeyGen request failed with status ${response.status}`);
  const payload = await response.json();
  fs.mkdirSync(request.outputDirectory, { recursive: true });
  const jobPath = path.join(request.outputDirectory, `${request.lessonId}.heygen-job.json`);
  fs.writeFileSync(jobPath, `${JSON.stringify(payload, null, 2)}\n`);

  return generationResult({
    provider: "heygen",
    artifactKind: request.artifactKind,
    status: "submitted",
    files: [jobPath],
    externalId: payload?.data?.video_id ?? payload?.video_id ?? null,
    metadata: { avatarId, voiceId },
  });
}
