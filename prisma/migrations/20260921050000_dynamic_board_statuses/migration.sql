-- AlterTable: Issue.status becomes free-form text backed by BoardColumn,
-- same as type/priority. "BACKLOG" stays a reserved literal, not a row.
ALTER TABLE "Issue" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Issue" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Issue" ALTER COLUMN "status" SET DEFAULT 'BACKLOG';

-- Seed the five built-in workflow stages as ordinary BoardColumn rows for
-- every existing board, after any custom columns it already has, so
-- everything is on equal footing (rename/delete both work the same way).
INSERT INTO "BoardColumn" ("id", "boardId", "name", "position", "createdAt")
SELECT
  gen_random_uuid()::text,
  b."id",
  stage.name,
  stage.ordinality - 1 + COALESCE(existing.max_position + 1, 0),
  CURRENT_TIMESTAMP
FROM "Board" b
CROSS JOIN unnest(ARRAY['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'READY_FOR_QA', 'DONE'])
  WITH ORDINALITY AS stage(name, ordinality)
LEFT JOIN (
  SELECT "boardId", MAX("position") AS max_position FROM "BoardColumn" GROUP BY "boardId"
) existing ON existing."boardId" = b."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "BoardColumn" c WHERE c."boardId" = b."id" AND c."name" = stage.name
);

-- DropForeignKey / DropColumn: the old customColumnId indirection collapses
-- into Issue.status now that every column (built-in or custom) is a plain
-- BoardColumn row addressed by name.
ALTER TABLE "Issue" DROP CONSTRAINT IF EXISTS "Issue_customColumnId_fkey";
DROP INDEX IF EXISTS "Issue_customColumnId_position_idx";

UPDATE "Issue" i
SET "status" = c."name"
FROM "BoardColumn" c
WHERE i."customColumnId" = c."id";

ALTER TABLE "Issue" DROP COLUMN "customColumnId";

-- DropEnum
DROP TYPE "IssueStatus";
