-- An environment's default auth (encrypted ApiAuth JSON).

-- AlterTable
ALTER TABLE "ProjectResource" ADD COLUMN     "encryptedAuth" TEXT;
