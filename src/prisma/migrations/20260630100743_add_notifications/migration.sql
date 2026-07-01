-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('issue_assigned', 'comment_added', 'mentioned');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "issue_id" TEXT,
    "entity_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipient_id_workspace_id_is_read_idx" ON "Notification"("recipient_id", "workspace_id", "is_read");

-- CreateIndex
CREATE INDEX "Notification_workspace_id_idx" ON "Notification"("workspace_id");

-- CreateIndex
CREATE INDEX "Notification_issue_id_idx" ON "Notification"("issue_id");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
