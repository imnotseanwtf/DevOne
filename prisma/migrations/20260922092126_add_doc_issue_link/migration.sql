-- CreateTable
CREATE TABLE "DocIssueLink" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocIssueLink_issueId_idx" ON "DocIssueLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "DocIssueLink_docId_issueId_key" ON "DocIssueLink"("docId", "issueId");

-- AddForeignKey
ALTER TABLE "DocIssueLink" ADD CONSTRAINT "DocIssueLink_docId_fkey" FOREIGN KEY ("docId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocIssueLink" ADD CONSTRAINT "DocIssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
