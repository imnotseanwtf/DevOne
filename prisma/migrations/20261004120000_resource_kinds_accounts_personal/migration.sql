-- Resources get a kind (API endpoint, app URL, git tags, Docker image), can be
-- personal (visible only to their owner), and hold login accounts.

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('API', 'APP', 'GIT_TAG', 'DOCKER_IMAGE');

-- Existing resources were all API endpoints (the default). The name is now
-- unique per scope (shared, or per owner), which the app checks.
-- DropIndex
DROP INDEX "ProjectResource_projectId_name_key";

-- AlterTable
ALTER TABLE "ProjectResource" ADD COLUMN     "image" TEXT,
ADD COLUMN     "imageTag" TEXT,
ADD COLUMN     "kind" "ResourceKind" NOT NULL DEFAULT 'API',
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "tagPattern" TEXT;

-- CreateTable
CREATE TABLE "ResourceAccount" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceAccount_resourceId_idx" ON "ResourceAccount"("resourceId");

-- CreateIndex
CREATE INDEX "ProjectResource_projectId_ownerId_idx" ON "ProjectResource"("projectId", "ownerId");

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAccount" ADD CONSTRAINT "ResourceAccount_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ProjectResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
