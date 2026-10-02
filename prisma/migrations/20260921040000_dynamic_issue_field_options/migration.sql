-- CreateEnum
CREATE TYPE "IssueFieldKind" AS ENUM ('TYPE', 'PRIORITY');

-- AlterTable: Issue.type / Issue.priority become free-form text backed by
-- IssueFieldOption instead of a fixed enum.
ALTER TABLE "Issue" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Issue" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Issue" ALTER COLUMN "type" SET DEFAULT 'TASK';

ALTER TABLE "Issue" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "Issue" ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "Issue" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE "IssueFieldOption" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "IssueFieldKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueFieldOption_projectId_kind_position_idx" ON "IssueFieldOption"("projectId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "IssueFieldOption_projectId_kind_name_key" ON "IssueFieldOption"("projectId", "kind", "name");

-- AddForeignKey
ALTER TABLE "IssueFieldOption" ADD CONSTRAINT "IssueFieldOption_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the built-in defaults for every existing project, plus any
-- non-default values already in use on their issues, so existing data keeps
-- working under the new dynamic lists.
INSERT INTO "IssueFieldOption" ("id", "projectId", "kind", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", 'TYPE', value, ordinality - 1, CURRENT_TIMESTAMP
FROM "Project", unnest(ARRAY['TASK', 'BUG', 'STORY', 'EPIC']) WITH ORDINALITY AS t(value, ordinality);

INSERT INTO "IssueFieldOption" ("id", "projectId", "kind", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", 'PRIORITY', value, ordinality - 1, CURRENT_TIMESTAMP
FROM "Project", unnest(ARRAY['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) WITH ORDINALITY AS t(value, ordinality);

-- Any issue type/priority value not among the defaults (shouldn't happen
-- with the old enum, but keeps existing rows valid if it did) gets its own
-- option too.
INSERT INTO "IssueFieldOption" ("id", "projectId", "kind", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, i."projectId", 'TYPE', i."type", 100, CURRENT_TIMESTAMP
FROM "Issue" i
WHERE NOT EXISTS (
  SELECT 1 FROM "IssueFieldOption" o
  WHERE o."projectId" = i."projectId" AND o."kind" = 'TYPE' AND o."name" = i."type"
)
GROUP BY i."projectId", i."type";

INSERT INTO "IssueFieldOption" ("id", "projectId", "kind", "name", "position", "createdAt")
SELECT gen_random_uuid()::text, i."projectId", 'PRIORITY', i."priority", 100, CURRENT_TIMESTAMP
FROM "Issue" i
WHERE NOT EXISTS (
  SELECT 1 FROM "IssueFieldOption" o
  WHERE o."projectId" = i."projectId" AND o."kind" = 'PRIORITY' AND o."name" = i."priority"
)
GROUP BY i."projectId", i."priority";

-- DropEnum
DROP TYPE "IssueType";
DROP TYPE "IssuePriority";
