-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Issue_boardId_archivedAt_idx" ON "Issue"("boardId", "archivedAt");
