import { prisma } from "@/lib/prisma";

type AuditInput = {
  organizationId?: string;
  actorId?: string;
  actorType: "system" | "user" | "service";
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
  outcome: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        correlationId: input.correlationId,
        outcome: input.outcome,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("studio audit event write failed", {
      organizationId: input.organizationId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
