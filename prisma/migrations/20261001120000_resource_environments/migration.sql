-- Resources become the project's environments: they gain keys/credentials,
-- a repository, and databases link to them. The API client's own environments
-- are folded into resources, then dropped.

-- AlterTable
ALTER TABLE "ProjectResource" ADD COLUMN     "repositoryId" TEXT,
ALTER COLUMN "url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DatabaseConnection" ADD COLUMN     "resourceId" TEXT;

-- CreateTable
CREATE TABLE "ResourceVariable" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceVariable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceVariable_resourceId_key_key" ON "ResourceVariable"("resourceId", "key");

-- CreateIndex
CREATE INDEX "DatabaseConnection_resourceId_idx" ON "DatabaseConnection"("resourceId");

-- CreateIndex
CREATE INDEX "ProjectResource_repositoryId_idx" ON "ProjectResource"("repositoryId");

-- AddForeignKey
ALTER TABLE "DatabaseConnection" ADD CONSTRAINT "DatabaseConnection_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ProjectResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVariable" ADD CONSTRAINT "ResourceVariable_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ProjectResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each API environment becomes a resource of the same name (keeping its id), unless
-- the project already has a resource with that name, in which case its variables
-- are added to that one. The environment type is guessed from the name.
INSERT INTO "ProjectResource" ("id", "projectId", "name", "environment", "createdAt", "updatedAt")
SELECT e."id", e."projectId", e."name",
       (CASE
          WHEN e."name" ~* 'prod' THEN 'PRODUCTION'
          WHEN e."name" ~* 'stag' THEN 'STAGING'
          WHEN e."name" ~* 'local' THEN 'LOCAL'
          ELSE 'DEVELOPMENT'
        END)::"DatabaseEnvironment",
       e."createdAt", e."updatedAt"
FROM "Environment" e
WHERE NOT EXISTS (
  SELECT 1 FROM "ProjectResource" r WHERE r."projectId" = e."projectId" AND r."name" = e."name"
);

-- Values stay encrypted with the same server key, so they are copied as they are.
-- A copied `baseUrl` keeps overriding the resource URL for `{{baseUrl}}`.
INSERT INTO "ResourceVariable" ("id", "resourceId", "key", "encryptedValue", "isSecret", "createdAt", "updatedAt")
SELECT v."id", r."id", v."key", v."encryptedValue", v."isSecret", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "EnvironmentVariable" v
JOIN "Environment" e ON e."id" = v."environmentId"
JOIN "ProjectResource" r ON r."projectId" = e."projectId" AND r."name" = e."name"
ON CONFLICT ("resourceId", "key") DO NOTHING;

-- A database connection joins the project's resource for its environment when
-- there is exactly one.
UPDATE "DatabaseConnection" c
SET "resourceId" = (
  SELECT r."id" FROM "ProjectResource" r
  WHERE r."projectId" = c."projectId" AND r."environment" = c."environment"
)
WHERE (
  SELECT COUNT(*) FROM "ProjectResource" r
  WHERE r."projectId" = c."projectId" AND r."environment" = c."environment"
) = 1;

-- DropForeignKey
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_projectId_fkey";

-- DropForeignKey
ALTER TABLE "EnvironmentVariable" DROP CONSTRAINT "EnvironmentVariable_environmentId_fkey";

-- DropTable
DROP TABLE "EnvironmentVariable";

-- DropTable
DROP TABLE "Environment";
