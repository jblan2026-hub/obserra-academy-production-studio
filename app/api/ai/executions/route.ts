import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit-service";
import { requireOrganization } from "@/lib/organization-service";
import { prisma } from "@/lib/prisma";
import { authorizeStudioRequest } from "@/lib/studio-auth";

export const dynamic = "force-dynamic";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    const session = await auth();
    if (!session.isAuthenticated || !session.orgId) {
      return NextResponse.json({ error: "An authenticated organization session is required", correlationId }, { status: 401 });
    }

    const organization = await requireOrganization(session.orgId);
    const executions = await prisma.aiExecution.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        course: { select: { id: true, slug: true, title: true } },
        expert: { select: { id: true, name: true, domain: true } },
        promptTemplate: { select: { id: true, key: true, name: true, version: true } },
        modelProfile: { select: { key: true, provider: true, model: true, displayName: true } },
        steps: { orderBy: { sequence: "asc" } },
      },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: session.userId ?? undefined,
      actorType: "user",
      action: "ai.execution.list",
      resourceType: "AiExecution",
      correlationId,
      outcome: "success",
      metadata: { count: executions.length },
    });

    return NextResponse.json({ correlationId, organizationId: session.orgId, executions });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      executions: [],
      warning: error instanceof Error ? error.message : "AI execution history unavailable",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "ai:execute");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "ai.execution.create",
      resourceType: "AiExecution",
      correlationId,
      outcome: "denied",
      metadata: { reason: authorization.reason },
    });
    return NextResponse.json({ error: authorization.reason ?? "Unauthorized", correlationId }, { status: 403 });
  }

  const principal = authorization.principal;

  try {
    const organization = await requireOrganization(principal.organizationId);
    const body = await request.json() as {
      objective?: string;
      input?: unknown;
      courseId?: string;
      expertId?: string;
      promptTemplateId?: string;
      modelProfileId?: string;
      maxRetries?: number;
    };

    const objective = body.objective?.trim();
    if (!objective) {
      return NextResponse.json({ error: "objective is required", correlationId }, { status: 400 });
    }

    if (body.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: body.courseId, organizationId: organization.id },
        select: { id: true },
      });
      if (!course) {
        return NextResponse.json({ error: "Course not found in the active organization", correlationId }, { status: 404 });
      }
    }

    if (body.promptTemplateId) {
      const template = await prisma.aiPromptTemplate.findFirst({
        where: { id: body.promptTemplateId, organizationId: organization.id, active: true },
        select: { id: true },
      });
      if (!template) {
        return NextResponse.json({ error: "Prompt template not found in the active organization", correlationId }, { status: 404 });
      }
    }

    const execution = await prisma.aiExecution.create({
      data: {
        organizationId: organization.id,
        courseId: body.courseId,
        expertId: body.expertId,
        promptTemplateId: body.promptTemplateId,
        modelProfileId: body.modelProfileId,
        requestedBy: principal.actorId,
        objective,
        input: asJson(body.input ?? {}),
        maxRetries: Math.min(Math.max(body.maxRetries ?? 2, 0), 5),
        status: "QUEUED",
        approvalStatus: "PENDING",
        guardrailStatus: "NOT_EVALUATED",
      },
      include: {
        course: { select: { slug: true, title: true } },
        expert: { select: { name: true, domain: true } },
        promptTemplate: { select: { key: true, name: true, version: true } },
        modelProfile: { select: { key: true, provider: true, model: true } },
      },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.execution.create",
      resourceType: "AiExecution",
      resourceId: execution.id,
      correlationId,
      outcome: "success",
      metadata: {
        objective,
        courseId: body.courseId,
        expertId: body.expertId,
        promptTemplateId: body.promptTemplateId,
        modelProfileId: body.modelProfileId,
        role: principal.role,
      },
    });

    return NextResponse.json({ correlationId, execution }, { status: 202 });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.execution.create",
      resourceType: "AiExecution",
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown" },
    });
    return NextResponse.json({ error: "AI execution creation failed", correlationId }, { status: 500 });
  }
}
