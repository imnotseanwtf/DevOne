-- Environments (resources) get a list of default request headers.

-- CreateTable
CREATE TABLE "ResourceHeader" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceHeader_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceHeader_resourceId_name_key" ON "ResourceHeader"("resourceId", "name");

-- AddForeignKey
ALTER TABLE "ResourceHeader" ADD CONSTRAINT "ResourceHeader_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ProjectResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single x-devone-bypass field (stored as the CF_BYPASS key) becomes an
-- ordinary header. The value is copied still encrypted with the same key.
INSERT INTO "ResourceHeader" ("id", "resourceId", "name", "encryptedValue", "isSecret", "createdAt", "updatedAt")
SELECT v."id", v."resourceId", 'x-devone-bypass', v."encryptedValue", true, v."createdAt", CURRENT_TIMESTAMP
FROM "ResourceVariable" v
WHERE v."key" = 'CF_BYPASS';

DELETE FROM "ResourceVariable" WHERE "key" = 'CF_BYPASS';
