-- AI router: a default model, tool-output compression, and how much it saved.

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN "savedChars" INTEGER;

-- CreateTable
CREATE TABLE "AiRouterSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultModel" TEXT,
    "compressToolOutput" BOOLEAN NOT NULL DEFAULT true,
    "maxToolOutputChars" INTEGER NOT NULL DEFAULT 30000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRouterSettings_pkey" PRIMARY KEY ("id")
);
