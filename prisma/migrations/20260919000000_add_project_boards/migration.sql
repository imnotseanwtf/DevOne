CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Board_projectId_name_key" ON "Board"("projectId", "name");
CREATE UNIQUE INDEX "Board_projectId_id_key" ON "Board"("projectId", "id");
ALTER TABLE "Board" ADD CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing project gets a default board; existing cards remain together.
INSERT INTO "Board" ("id", "projectId", "name")
SELECT 'default-' || "id", "id", 'Board' FROM "Project";

ALTER TABLE "Issue" ADD COLUMN "boardId" TEXT;
UPDATE "Issue" SET "boardId" = 'default-' || "projectId";
ALTER TABLE "Issue" ALTER COLUMN "boardId" SET NOT NULL;
CREATE INDEX "Issue_boardId_status_position_idx" ON "Issue"("boardId", "status", "position");
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_boardId_fkey" FOREIGN KEY ("projectId", "boardId") REFERENCES "Board"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
