import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const courseId = arg("--course");
const provider = (arg("--provider") || process.env.ACADEMY_AUTHORING_PROVIDER || "openai").toLowerCase();
const force = process.argv.includes("--force");
if (!courseId) {
  console.error("Usage: node studio/author-course-ai.mjs --course <course-id> [--provider openai|anthropic] [--force]");
  process.exit(1);
}

const courseDir = path.join(root, "courses", courseId);
const manifestPath = path.join(courseDir, "course-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`[Academy Studio] Course manifest not found for ${courseId}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const proprietaryNotice = "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.";
const legalName = "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC";

function authoringPrompt() {
  const course = manifest.course;
  return `You are the senior instructional design and subject matter authoring engine for ${legalName}.

Create an original, commercially credible, high quality professional course package for the course below. Do not imitate third party courseware. Do not claim accreditation, certification, legal advice, regulatory approval, or guaranteed outcomes. Use mature professional language, substantive paragraphs, varied scenarios, practical judgment, clear evidence boundaries, and realistic executive and operational examples.

Course title: ${course.title}
Department: ${course.department}
Track: ${course.track}
Level: ${course.level}
Audience: ${course.audience}
Course length: ${course.duration}
Description: ${course.description}
Learning outcomes: ${JSON.stringify(course.outcomes)}
Modules: ${JSON.stringify(course.modules)}
Passing score: ${manifest.completion.passingScore}
Access model: one time purchase, named learner, access until completion
Certificate issuer: ${legalName}
Handling notice: ${proprietaryNotice}

Return one valid JSON object only. Use this exact top level structure:
{
  "courseSummary": {"executiveValue": "", "instructionalStrategy": "", "sourceAndReviewNotes": []},
  "modules": [
    {
      "id": "",
      "title": "",
      "duration": "",
      "format": "",
      "learningObjectives": [],
      "openingContext": "",
      "lessonNarrative": "",
      "keyConcepts": [{"term": "", "explanation": ""}],
      "executiveExample": "",
      "operationalExample": "",
      "scenario": {"situation": "", "evidence": [], "decisionPrompt": "", "recommendedApproach": "", "debrief": ""},
      "exercise": {"instructions": "", "deliverable": "", "rubric": []},
      "knowledgeChecks": [{"question": "", "options": [], "correctIndex": 0, "rationale": ""}],
      "slideNarrative": [{"title": "", "content": [], "speakerNotes": "", "visualDirection": ""}],
      "videoScript": {"opening": "", "segments": [{"visual": "", "narration": ""}], "closing": ""},
      "accessibilityNotes": [],
      "sourcePlaceholders": []
    }
  ],
  "finalAssessment": [{"question": "", "options": [], "correctIndex": 0, "rationale": "", "moduleId": ""}],
  "learnerWorkbook": [{"moduleId": "", "reflectionPrompts": [], "decisionWorksheet": []}],
  "instructorGuide": {"facilitationNotes": [], "commonMisconceptions": [], "reviewWarnings": []},
  "marketing": {"shortDescription": "", "longDescription": "", "buyerOutcomes": [], "seoKeywords": []},
  "brand": {"legalName": "${legalName}", "proprietaryNotice": "${proprietaryNotice}", "visualSystem": "Official Obserra black, dark navy, gold, white, and restrained holographic blue"}
}

Quality requirements:
1. Every listed module must appear exactly once and preserve its title, duration, and format.
2. Each lessonNarrative must be substantive, specific to the course, and at least 700 words.
3. Each module must include at least 4 key concepts, 1 executive example, 1 operational example, 1 realistic scenario, 1 applied exercise, 4 knowledge checks, 8 slide narratives, and a complete video script.
4. The final assessment must contain at least 25 questions distributed across all modules.
5. Questions must test application and judgment, not trivia.
6. Avoid repeating the same scenario, explanation, or phrasing between modules.
7. Include source placeholders for facts that require later verification by a subject matter expert.
8. Keep all generated material marked proprietary and review required.
9. Do not use unsupported statistics or invented citations.
10. Preserve secure by design, ethical leadership, human oversight, and defensible decision making where relevant.`;
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  const response = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
      input: prompt,
      text: { format: { type: "json_object" } },
      reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "high" },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI authoring request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not contain output text");
  return text;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const response = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5",
      max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 64000),
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic authoring request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const text = payload.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Anthropic response did not contain text");
  return text;
}

function parseJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}

const outputDir = path.join(courseDir, "generated", "authoring");
const outputPath = path.join(outputDir, "course-package.json");
if (fs.existsSync(outputPath) && !force) {
  console.log(`[Academy Studio] Preserved existing AI authored package for ${courseId}. Use --force to regenerate.`);
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const prompt = authoringPrompt();
fs.writeFileSync(path.join(outputDir, "authoring-prompt.txt"), `${proprietaryNotice}\n\n${prompt}\n`);

const raw = provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
const authored = parseJson(raw);
const envelope = {
  schemaVersion: "1.0",
  courseId,
  provider,
  model: provider === "anthropic" ? process.env.ANTHROPIC_AUTHORING_MODEL || "claude-sonnet-4-5" : process.env.OPENAI_AUTHORING_MODEL || "gpt-5",
  generatedAt: new Date().toISOString(),
  reviewStatus: "draft-ai-generated",
  legalName,
  proprietaryNotice,
  content: authored,
};
fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`[Academy Studio] Generated governed AI course package for ${courseId} through ${provider}`);
