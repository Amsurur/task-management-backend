-- Adds message kinds (media/voice/file), attachment metadata, and edit/delete
-- markers to the chat Message table.

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('text', 'image', 'video', 'audio', 'voice', 'file');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'text';
ALTER TABLE "Message" ALTER COLUMN "body" SET DEFAULT '';
ALTER TABLE "Message" ADD COLUMN "attachment_key" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachment_name" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachment_size" INTEGER;
ALTER TABLE "Message" ADD COLUMN "attachment_mime" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachment_duration" INTEGER;
ALTER TABLE "Message" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "deleted_at" TIMESTAMP(3);
