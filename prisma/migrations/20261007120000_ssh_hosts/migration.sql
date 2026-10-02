-- Saved servers for the DevOps SSH terminal: personal, credentials encrypted.

-- CreateEnum
CREATE TYPE "SshAuthMethod" AS ENUM ('PASSWORD', 'PRIVATE_KEY');

-- CreateTable
CREATE TABLE "SshHost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "authMethod" "SshAuthMethod" NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "encryptedPassphrase" TEXT,
    "hostKeyFingerprint" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshHost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SshHost_ownerId_idx" ON "SshHost"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SshHost_projectId_ownerId_name_key" ON "SshHost"("projectId", "ownerId", "name");

-- AddForeignKey
ALTER TABLE "SshHost" ADD CONSTRAINT "SshHost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshHost" ADD CONSTRAINT "SshHost_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
