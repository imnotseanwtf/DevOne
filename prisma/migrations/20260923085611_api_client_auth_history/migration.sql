-- CreateEnum
CREATE TYPE "ApiBodyType" AS ENUM ('NONE', 'JSON', 'TEXT', 'FORM');

-- AlterTable
ALTER TABLE "ApiRequest" ADD COLUMN     "authJson" JSONB,
ADD COLUMN     "bodyType" "ApiBodyType" NOT NULL DEFAULT 'JSON';

-- CreateTable
CREATE TABLE "ApiHistoryEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "HttpMethod" NOT NULL,
    "url" TEXT NOT NULL,
    "headersJson" JSONB,
    "body" TEXT,
    "bodyType" "ApiBodyType" NOT NULL DEFAULT 'JSON',
    "authJson" JSONB,
    "status" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiHistoryEntry_projectId_userId_createdAt_idx" ON "ApiHistoryEntry"("projectId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApiHistoryEntry" ADD CONSTRAINT "ApiHistoryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiHistoryEntry" ADD CONSTRAINT "ApiHistoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
