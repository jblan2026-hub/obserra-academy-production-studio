import { Prisma } from "@prisma/client";

import { recordAuditEvent } from "../lib/audit-service";
import { freeAiHealth, executeFreeAi } from "../lib/free-ai-service";
import { prisma } from "../lib/prisma";

const batchSize = Math.max(1, Math.min(100, Number(process.env.STUDIO_FREE_WORKER_BATCH_SIZE || 10)));

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function claimExecution(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    WITH next_execution AS (
      SELECT "id"
      FROM "AiExecution"
      WHERE "status" = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "AiExecution" AS execution
    SET "status" = 'RUNNING',
        "startedAt" = COALESCE(execution."startedAt", CURRENT_TIMESTAMP),
        "updatedAt" = CURRENT_TIMESTAMP
    FROM next_execution
    WHERE execution."id" = next_execution."id"
    RETURNING execution."id"
  `);
  return rows[0]?.id ?? null;
}

async function processExecution(executionId: string): Promise<void> {
  const execution = await prisma.aiExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: {
      promptTemplate: true,
      course: { select: { slug: true, title: true } },
      expert: { select: { name: true, domain: true } },
    },
  });

  const systemPrompt = execution.promptTemplate?.systemPrompt?.trim() ||
    "You are the Obserra Academy local backend assistant. Produce accurate, structured professional output. Do not invent authorities, citations, facts, or completion evidence.";
  const taskTemplate = execution.promptTemplate?.taskTemplate?.trim() || execution.objective;
  const requestPayload = {
    objective: execution.objective,
    course: execution.course,
    expert: execution.expert,
    input: execution.input,
    taskTemplate,
  };

  try {
    const result = await executeFreeAi({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(requestPayload, null, 2) },
      ],
      responseFormat: execution.promptTemplate?.outputSchema ? "json" : "text",
      temperature: 0.2,
    });

    let output: unknown = { content: result.content };
    if (execution.promptTemplate?.outputSchema) {
      try { output = JSON.parse(result.content); } catch { output = { content: result.content, structuredOutputParseFailed: true }; }
    }

    await prisma.aiExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCEEDED",
        approvalStatus: "PENDING",
        guardrailStatus: "PASSED",
        output: toJson(output),
        promptTokens: result.inputTokens,
        completionTokens: result.outputTokens,
        estimatedCostUsd: 0,
        confidence: null,
        provenance: toJson({
          provider: result.provider,
          model: result.model,
          estimatedCostUsd: 0,
          freeFirstBackend: true,
        }),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    await recordAuditEvent({
      organizationId: execution.organizationId,
      actorId: "free-ai-worker",
      actorType: "service",
      action: "ai.execution.local.complete",
      resourceType: "AiExecution",
      resourceId: execution.id,
      outcome: "success",
      metadata: { provider: result.provider, model: result.model, estimatedCostUsd: 0 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.aiExecution.update({
      where: { id: execution.id },
      data: {
        status: "FAILED",
        guardrailStatus: "BLOCKED",
        errorCode: "LOCAL_AI_EXECUTION_FAILED",
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
      },
    });
    await recordAuditEvent({
      organizationId: execution.organizationId,
      actorId: "free-ai-worker",
      actorType: "service",
      action: "ai.execution.local.complete",
      resourceType: "AiExecution",
      resourceId: execution.id,
      outcome: "failure",
      metadata: { reason: message.slice(0, 1000), estimatedCostUsd: 0 },
    });
    throw error;
  }
}

const health = await freeAiHealth();
if (!health.reachable) {
  console.error(`[Academy Backend] Local AI is not reachable at configured endpoint. No queued execution was claimed. ${health.detail || ""}`);
  process.exitCode = 3;
} else {
  let processed = 0;
  while (processed < batchSize) {
    const executionId = await claimExecution();
    if (!executionId) break;
    console.log(`[Academy Backend] Processing queued AI execution ${executionId} with ${health.provider}/${health.model}.`);
    await processExecution(executionId);
    processed += 1;
  }
  console.log(`[Academy Backend] Free AI worker processed ${processed} queued execution(s) at $0 model cost.`);
}

await prisma.$disconnect();
