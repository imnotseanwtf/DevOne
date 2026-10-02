-- Public demo accounts expire and are cleaned up with their sample workspace.
ALTER TABLE "User" ADD COLUMN "demoExpiresAt" TIMESTAMP(3);

CREATE INDEX "User_demoExpiresAt_idx" ON "User"("demoExpiresAt");
