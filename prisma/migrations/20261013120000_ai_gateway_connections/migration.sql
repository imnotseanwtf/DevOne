ALTER TABLE "AiProvider"
  ADD COLUMN "providerType" TEXT NOT NULL DEFAULT 'custom',
  ADD COLUMN "alias" TEXT,
  ADD COLUMN "format" TEXT NOT NULL DEFAULT 'openai',
  ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'api_key';

CREATE UNIQUE INDEX "AiProvider_alias_lower_key" ON "AiProvider"(lower("alias")) WHERE "alias" IS NOT NULL;

CREATE TABLE "AiConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerId" TEXT NOT NULL REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "authType" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "encryptedApiKey" TEXT,
  "encryptedAccessToken" TEXT,
  "encryptedRefreshToken" TEXT,
  "encryptedIdToken" TEXT,
  "expiresAt" TIMESTAMP(3),
  "lastRefreshAt" TIMESTAMP(3),
  "providerSpecificData" JSONB NOT NULL DEFAULT '{}',
  "allowedModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "modelLocks" JSONB NOT NULL DEFAULT '{}',
  "rateLimitedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AiConnection_providerId_isActive_priority_idx" ON "AiConnection"("providerId", "isActive", "priority");

-- Preserve every existing provider, key and cooldown as its first account.
INSERT INTO "AiConnection" ("id", "providerId", "name", "authType", "encryptedApiKey", "priority", "rateLimitedUntil", "lastError", "createdAt", "updatedAt")
SELECT "id" || '-primary', "id", 'Primary', CASE WHEN "encryptedApiKey" IS NULL THEN 'none' ELSE 'api_key' END,
       "encryptedApiKey", "priority", "cooldownUntil", "lastError", "createdAt", "updatedAt"
FROM "AiProvider";

UPDATE "AiProvider" SET "authType" = 'none' WHERE "encryptedApiKey" IS NULL;

CREATE TABLE "AiOAuthSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerId" TEXT NOT NULL REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "stateHash" TEXT NOT NULL,
  "configHash" TEXT NOT NULL,
  "encryptedCodeVerifier" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiOAuthSession_stateHash_key" ON "AiOAuthSession"("stateHash");
CREATE INDEX "AiOAuthSession_expiresAt_idx" ON "AiOAuthSession"("expiresAt");

ALTER TABLE "AiUsage" ADD COLUMN "connectionId" TEXT REFERENCES "AiConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
