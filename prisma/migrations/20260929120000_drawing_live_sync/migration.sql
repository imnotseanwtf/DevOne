-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN     "live" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DrawingElement" (
    "drawingId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "versionNonce" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "DrawingElement_pkey" PRIMARY KEY ("drawingId","elementId")
);

-- CreateTable
CREATE TABLE "DrawingPresence" (
    "drawingId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingPresence_pkey" PRIMARY KEY ("drawingId","clientId")
);

-- CreateIndex
CREATE INDEX "DrawingElement_drawingId_revision_idx" ON "DrawingElement"("drawingId", "revision");

-- CreateIndex
CREATE INDEX "DrawingPresence_drawingId_updatedAt_idx" ON "DrawingPresence"("drawingId", "updatedAt");

-- AddForeignKey
ALTER TABLE "DrawingElement" ADD CONSTRAINT "DrawingElement_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingPresence" ADD CONSTRAINT "DrawingPresence_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingPresence" ADD CONSTRAINT "DrawingPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

