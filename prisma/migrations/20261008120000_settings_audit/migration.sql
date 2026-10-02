-- Settings: project DevOps controls, production branch, user preferences and
-- disabling, session details, and the audit log.

-- CreateEnum
CREATE TYPE "TerminalAccess" AS ENUM ('DISABLED', 'OWNERS', 'MEMBERS');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hiddenPipelineBranches" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sshAllowedHosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "terminalAccess" "TerminalAccess" NOT NULL DEFAULT 'MEMBERS';

-- AlterTable
ALTER TABLE "ProjectRepository" ADD COLUMN     "productionBranch" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON "AuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

