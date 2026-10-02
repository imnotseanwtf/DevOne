-- AlterTable
ALTER TABLE "ApiHistoryEntry" ADD COLUMN     "pathParamsJson" JSONB;

-- AlterTable
ALTER TABLE "ApiRequest" ADD COLUMN     "pathParamsJson" JSONB;
