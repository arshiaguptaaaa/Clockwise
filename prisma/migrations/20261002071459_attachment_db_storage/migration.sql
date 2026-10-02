-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "content" BYTEA,
ADD COLUMN     "storage" TEXT NOT NULL DEFAULT 'BLOB';

