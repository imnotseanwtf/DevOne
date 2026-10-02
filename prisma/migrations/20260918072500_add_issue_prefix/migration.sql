
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "issueCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "issuePrefix" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Project_issuePrefix_key" ON "Project"("issuePrefix");

