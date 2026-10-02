-- CreateEnum
CREATE TYPE "FolderScope" AS ENUM ('DOC', 'DRAWING');

-- CreateTable
CREATE TABLE "ContentFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" "FolderScope" NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentFolder_projectId_scope_path_key" ON "ContentFolder"("projectId", "scope", "path");

-- AddForeignKey
ALTER TABLE "ContentFolder" ADD CONSTRAINT "ContentFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the folders that already exist (they were implied by the pages and drawings in them).
INSERT INTO "ContentFolder" ("id", "projectId", "scope", "path")
SELECT gen_random_uuid()::text, "projectId", 'DOC', "folder"
FROM (SELECT DISTINCT "projectId", "folder" FROM "DocPage" WHERE "folder" IS NOT NULL) AS docs;

INSERT INTO "ContentFolder" ("id", "projectId", "scope", "path")
SELECT gen_random_uuid()::text, "projectId", 'DRAWING', "folder"
FROM (SELECT DISTINCT "projectId", "folder" FROM "Drawing" WHERE "folder" IS NOT NULL) AS drawings;
