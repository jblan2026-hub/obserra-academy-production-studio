import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit-service";
import { requireOrganization } from "@/lib/organization-service";
import { prisma } from "@/lib/prisma";
import { authorizeStudioRequest } from "@/lib/studio-auth";

export const dynamic = "force-dynamic";

type OrchestrationStepInput = {
  name?: string;
  agentRole?: string;
  expertId?: string;
  modelProfileKey?: string;
  dependsOn?: number[];
  input?: Record<string, unknown>;
};

type CreateOrchestrationBody = {
  courseId?: string;
  objective?: string;
  promptTemplateId?: string;
  modelProfileId?: string;
  maxRetries?: number;
  input?: Record<string, unknown>;
  steps?: OrchestrationStepInput[];
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const session = await auth();
    if (!session.isAuthenticated || !session.orgId) {
      return NextResponse.json({ error: "An authenticated organization session is required", correlationId }, { status: 401 });
    }

    const organization = await requireOrganization(session.orgId);
    const orchestrations = await prisma.aiExecution.findMany({
      where: {
        organizationId: organization.id,
        steps: { some: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        course: { select: { id: true, slug: true, title: true } },
        promptTemplate: { select: { id: true, key: true, name: true, version: true } },
        modelProfile: { select: { id: true, key: true, provider: true, model: true, displayName: true } },
        steps: { orderBy: { sequence: "asc" } },
      },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: session.userId ?? undefined,
      actorType: "user",
      action: "ai.orchestration.list",
      resourceType: "AiExecution",
      correlationId,
      outcome: "success",
      metadata: { count: orchestrations.length },
    });

    return NextResponse.json({ correlationId, organizationId: session.orgId, orchestrations });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      orchestrations: [],
      warning: error instanceof Error ? error.message : "AI orchestration history unavailable",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "ai:execute");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "ai.orchestration.create",
      resourceType: "AiExecution",
      correlationId,
      outcome: "denied",
      metadata: { reason: authorization.reason },
    });
    return NextResponse.json({ error: authorization.reason ?? "Unauthorized", correlationId }, { status: 403 });
  }

  const principal = authorization.principal;

  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
    const organization = await requireOrganization(principal.organizationId);
    const body = await request.json() as CreateOrchestrationBody;
    const objective = body.objective?.trim();
    const steps = body.steps ?? [];

    if (!objective) {
      return NextResponse.json({ error: "objective is required", correlationId }, { status: 400 });
    }
    if (steps.length === 0) {
      return NextResponse.json({ error: "At least one orchestration step is required", correlationId }, { status: 400 });
    }
    if (steps.length > 50) {
      return NextResponse.json({ error: "An orchestration may contain no more than 50 steps", correlationId }, { status: 400 });
    }

    const sequences = new Set<number>();
    const normalizedSteps = steps.map((step, index) => {
      const sequence = index + 1;
      sequences.add(sequence);
      const dependsOn = Array.from(new Set(step.dependsOn ?? [])).sort((a, b) => a - b);
      if (dependsOn.some((dependency) => dependency < 1 || dependency >= sequence)) {
        throw new Error(`Step ${sequence} contains an invalid dependency`);
      }
      return {
        sequence,
        name: step.name?.trim() || `Step ${sequence}`,
        agentRole: step.agentRole?.trim() || undefined,
        expertId: step.expertId,
        modelProfileKey: step.modelProfileKey?.trim() || undefined,
        dependsOn,
        input: step.input ?? {},
      };
    });

    let course: { id: string } | null = null;
    if (body.courseId) {
      course = await prisma.course.findFirst({
        where: { id: body.courseId, organizationId: organization.id },
        select: { id: true },
      });
      if (!course) {
        return NextResponse.json({ error: "Course not found in the active organization", correlationId }, { status: 404 });
      }
    }

    if (body.promptTemplateId) {
      const prompt = await prisma.aiPromptTemplate.findFirst({
        where: { id: body.promptTemplateId, organizationId: organization.id, active: true },
        select: { id: true },
      });
      if (!prompt) {
        return NextResponse.json({ error: "Prompt template not found in the active organization", correlationId }, { status: 404 });
      }
    }

    const expertIds = normalizedSteps.map((step) => step.expertId).filter((value): value is string => Boolean(value));
    if (expertIds.length > 0) {
      const experts = await prisma.expertAgent.count({ where: { id: { in: expertIds }, active: true } });
      if (experts !== new Set(expertIds).size) {
        return NextResponse.json({ error: "One or more expert agents are missing or inactive", correlationId }, { status: 400 });
      }
    }

    const execution = await prisma.$transaction(async (transaction) => {
      const parent = await transaction.aiExecution.create({
        data: {
          organizationId: organization.id,
          courseId: course?.id,
          promptTemplateId: body.promptTemplateId,
          modelProfileId: body.modelProfileId,
          requestedBy: principal.actorId,
          objective,
          status: "QUEUED",
          approvalStatus: "PENDING",
          guardrailStatus: "NOT_EVALUATED",
          maxRetries: Math.min(Math.max(body.maxRetries ?? 2, 0), 5),
          input: toJson({
            orchestration: true,
            requestedInput: body.input ?? {},
            dependencyGraph: normalizedSteps.map((step) => ({ sequence: step.sequence, dependsOn: step.dependsOn })),
          }),
        },
      });

      await transaction.aiExecutionStep.createMany({
        data: normalizedSteps.map((step) => ({
          executionId: parent.id,
          sequence: step.sequence,
          name: step.name,
          agentRole: step.agentRole,
          modelProfileKey: step.modelProfileKey,
          status: "PENDING",
          input: toJson({
            expertId: step.expertId,
            dependsOn: step.dependsOn,
            payload: step.input,
          }),
        })),
      });

      return transaction.aiExecution.findUniqueOrThrow({
        where: { id: parent.id },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.orchestration.create",
      resourceType: "AiExecution",
      resourceId: execution.id,
      correlationId,
      outcome: "success",
      metadata: {
        objective,
        courseId: course?.id,
        stepCount: execution.steps.length,
        role: principal.role,
      },
    });

    return NextResponse.json({ correlationId, orchestration: execution }, { status: 202 });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.orchestration.create",
      resourceType: "AiExecution",
      correlationId,
      outcome: "failure",
      metadata: {
        reason: error instanceof Error ? error.message : "unknown",
        clerkOrganizationId: principal.organizationId,
      },
    });

    return NextResponse.json({
      error: error instanceof Error ? error.message : "AI orchestration creation failed",
      correlationId,
    }, { status: 500 });
  }
}
