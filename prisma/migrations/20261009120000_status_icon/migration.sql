-- A board status can show a chosen icon; null keeps the one picked from its name.

-- AlterTable
ALTER TABLE "BoardColumn" ADD COLUMN     "icon" TEXT;
