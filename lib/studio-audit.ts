import { prisma } from "@/lib/prisma";

export type AuditInput = {
  actorId?: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
  outcome: string;
  metadata?: Record<string, unknown>;
};

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
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
    console.error("Studio audit event write failed", {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
