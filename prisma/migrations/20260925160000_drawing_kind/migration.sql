-- CreateEnum
CREATE TYPE "DrawingKind" AS ENUM ('EXCALIDRAW', 'DRAWIO');

-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN     "kind" "DrawingKind" NOT NULL DEFAULT 'EXCALIDRAW';

