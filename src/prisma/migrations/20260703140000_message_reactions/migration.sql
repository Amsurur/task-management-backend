-- Emoji reactions on chat messages (Telegram-style tap-to-react).

-- CreateTable
CREATE TABLE "MessageReaction" (
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("message_id","user_id","emoji")
);

-- CreateIndex
CREATE INDEX "MessageReaction_message_id_idx" ON "MessageReaction"("message_id");

-- CreateIndex
CREATE INDEX "MessageReaction_user_id_idx" ON "MessageReaction"("user_id");

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
