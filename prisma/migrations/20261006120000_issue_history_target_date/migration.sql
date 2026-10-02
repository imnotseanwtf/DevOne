-- Tasks get an optional target date and a history of changes (status moves,
-- assignee, priority, target date, archive/restore).

-- CreateEnum
CREATE TYPE "IssueEventType" AS ENUM ('CREATED', 'STATUS', 'ASSIGNEE', 'PRIORITY', 'TARGET_DATE', 'ARCHIVED', 'RESTORED');

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "targetDate" DATE;

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "IssueEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "viaGit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueEvent_issueId_createdAt_idx" ON "IssueEvent"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing tasks start their history with when and where they were created;
-- earlier moves weren't recorded.
INSERT INTO "IssueEvent" ("id", "issueId", "actorId", "type", "toValue", "createdAt")
SELECT gen_random_uuid()::text, i."id", i."createdById", 'CREATED', i."status", i."createdAt"
FROM "Issue" i;
