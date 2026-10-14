-- More database engines: SQLite, SQL Server, MongoDB, Redis and DynamoDB.

-- AlterEnum
ALTER TYPE "DatabaseProvider" ADD VALUE 'SQLITE';
ALTER TYPE "DatabaseProvider" ADD VALUE 'MSSQL';
ALTER TYPE "DatabaseProvider" ADD VALUE 'MONGODB';
ALTER TYPE "DatabaseProvider" ADD VALUE 'REDIS';
ALTER TYPE "DatabaseProvider" ADD VALUE 'DYNAMODB';

-- AlterTable
ALTER TABLE "DatabaseConnection" ADD COLUMN "endpoint" TEXT;
