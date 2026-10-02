-- DropIndex
DROP INDEX "ApiRequest_collectionId_idx";

-- AlterTable
ALTER TABLE "ApiRequest" ADD COLUMN     "docsJson" JSONB,
ADD COLUMN     "folder" TEXT;

-- CreateIndex
CREATE INDEX "ApiRequest_collectionId_folder_idx" ON "ApiRequest"("collectionId", "folder");
