-- CreateEnum
CREATE TYPE "DatabaseProvider" AS ENUM ('POSTGRES', 'MYSQL');

-- CreateEnum
CREATE TYPE "DatabaseEnvironment" AS ENUM ('LOCAL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateTable
CREATE TABLE "DatabaseConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "DatabaseProvider" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "databaseName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "sslEnabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" "DatabaseEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaSnapshot" (
    "id" TEXT NOT NULL,
    "databaseConnectionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedQuery" (
    "id" TEXT NOT NULL,
    "databaseConnectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseConnection_projectId_idx" ON "DatabaseConnection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseConnection_projectId_name_key" ON "DatabaseConnection"("projectId", "name");

-- CreateIndex
CREATE INDEX "SchemaSnapshot_databaseConnectionId_createdAt_idx" ON "SchemaSnapshot"("databaseConnectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchemaSnapshot_databaseConnectionId_contentHash_key" ON "SchemaSnapshot"("databaseConnectionId", "contentHash");

-- CreateIndex
CREATE INDEX "SavedQuery_databaseConnectionId_idx" ON "SavedQuery"("databaseConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedQuery_databaseConnectionId_name_key" ON "SavedQuery"("databaseConnectionId", "name");

-- AddForeignKey
ALTER TABLE "DatabaseConnection" ADD CONSTRAINT "DatabaseConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaSnapshot" ADD CONSTRAINT "SchemaSnapshot_databaseConnectionId_fkey" FOREIGN KEY ("databaseConnectionId") REFERENCES "DatabaseConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuery" ADD CONSTRAINT "SavedQuery_databaseConnectionId_fkey" FOREIGN KEY ("databaseConnectionId") REFERENCES "DatabaseConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
