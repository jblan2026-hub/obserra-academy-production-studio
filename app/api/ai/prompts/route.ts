import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit-service";
import { requireOrganization } from "@/lib/organization-service";
import { prisma } from "@/lib/prisma";
import { authenticateStudioRequest, authorizeStudioRequest } from "@/lib/studio-auth";

export const dynamic = "force-dynamic";

function asNullableJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    const authentication = await authenticateStudioRequest(request);
    if (!authentication.principal) {
      return NextResponse.json({ error: authentication.reason ?? "Authentication required", correlationId }, { status: 401 });
    }
    const principal = authentication.principal;
    const organization = await requireOrganization(principal.organizationId, principal.identityProvider);
    const prompts = await prisma.aiPromptTemplate.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ key: "asc" }, { version: "desc" }],
      include: { expert: { select: { id: true, name: true, domain: true } } },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.prompt.list",
      resourceType: "AiPromptTemplate",
      correlationId,
      outcome: "success",
      metadata: { count: prompts.length, identityProvider: principal.identityProvider },
    });

    return NextResponse.json({ correlationId, organizationId: principal.organizationId, prompts });
  } catch (error) {
    return NextResponse.json({
      correlationId,
      prompts: [],
      warning: error instanceof Error ? error.message : "Prompt library unavailable",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await authorizeStudioRequest(request, "prompt:manage");

  if (!authorization.principal) {
    await recordAuditEvent({
      actorType: "service",
      action: "ai.prompt.create",
      resourceType: "AiPromptTemplate",
      correlationId,
      outcome: "denied",
      metadata: { reason: authorization.reason },
    });
    return NextResponse.json({ error: authorization.reason ?? "Unauthorized", correlationId }, { status: 403 });
  }

  const principal = authorization.principal;

  try {
    const organization = await requireOrganization(principal.organizationId, principal.identityProvider);
    const body = await request.json() as {
      key?: string;
      name?: string;
      systemPrompt?: string;
      taskTemplate?: string;
      expertId?: string;
      outputSchema?: unknown;
      guardrails?: unknown;
    };

    const key = body.key?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const name = body.name?.trim();
    const systemPrompt = body.systemPrompt?.trim();
    const taskTemplate = body.taskTemplate?.trim();

    if (!key || !name || !systemPrompt || !taskTemplate) {
      return NextResponse.json({
        error: "key, name, systemPrompt, and taskTemplate are required",
        correlationId,
      }, { status: 400 });
    }

    const latest = await prisma.aiPromptTemplate.findFirst({
      where: { organizationId: organization.id, key },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const prompt = await prisma.aiPromptTemplate.create({
      data: {
        organizationId: organization.id,
        expertId: body.expertId,
        key,
        name,
        version: (latest?.version ?? 0) + 1,
        systemPrompt,
        taskTemplate,
        outputSchema: asNullableJson(body.outputSchema),
        guardrails: asNullableJson(body.guardrails),
        createdBy: principal.actorId,
        active: true,
      },
      include: { expert: { select: { name: true, domain: true } } },
    });

    await prisma.aiPromptTemplate.updateMany({
      where: {
        organizationId: organization.id,
        key,
        id: { not: prompt.id },
      },
      data: { active: false },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.prompt.create",
      resourceType: "AiPromptTemplate",
      resourceId: prompt.id,
      correlationId,
      outcome: "success",
      metadata: { key, version: prompt.version, expertId: body.expertId, role: principal.role, identityProvider: principal.identityProvider },
    });

    return NextResponse.json({ correlationId, prompt }, { status: 201 });
  } catch (error) {
    await recordAuditEvent({
      actorId: principal.actorId,
      actorType: principal.actorType,
      action: "ai.prompt.create",
      resourceType: "AiPromptTemplate",
      correlationId,
      outcome: "failure",
      metadata: { reason: error instanceof Error ? error.message : "unknown", identityProvider: principal.identityProvider },
    });
    return NextResponse.json({ error: "Prompt template creation failed", correlationId }, { status: 500 });
  }
}
