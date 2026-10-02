-- DropForeignKey
ALTER TABLE "BoardColumn" DROP CONSTRAINT "BoardColumn_boardId_fkey";

-- DropForeignKey
ALTER TABLE "Issue" DROP CONSTRAINT "Issue_customColumnId_fkey";

-- DropIndex
DROP INDEX "Issue_customColumnId_position_idx";

-- AlterTable
ALTER TABLE "Issue" DROP COLUMN "customColumnId";

-- DropTable
DROP TABLE "BoardColumn";

