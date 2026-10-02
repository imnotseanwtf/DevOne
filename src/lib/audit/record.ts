import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';

export interface AuditInput {
  actorId: string;
  action: string;
  projectId?: string | null;
  target?: string | null;
  details?: Prisma.InputJsonValue;
}

/**
 * Appends to the audit log. A failed write never fails the change it records:
 * the change already happened, and refusing to report it helps no one.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  await getPrisma()
    .auditEvent.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        projectId: input.projectId ?? null,
        target: input.target ?? null,
        details: input.details
      }
    })
    .catch(() => undefined);
}
