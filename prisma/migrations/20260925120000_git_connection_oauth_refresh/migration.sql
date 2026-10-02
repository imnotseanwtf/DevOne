-- AlterTable
ALTER TABLE "GitConnection" ADD COLUMN     "encryptedRefreshToken" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);
