-- Messaging overhaul (Phase 2): swipe-to-reply threading + the reserved
-- @pathwise assistant identity.
ALTER TABLE "DirectMessage" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
