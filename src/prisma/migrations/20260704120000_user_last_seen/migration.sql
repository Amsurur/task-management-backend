-- Presence: remember when a user was last online (for "last seen" in chat).
ALTER TABLE "User" ADD COLUMN "last_seen_at" TIMESTAMP(3);
