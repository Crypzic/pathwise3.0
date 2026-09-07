-- Guest mode (PATHWISE 2.0 Phase 1): guests are ordinary User rows with a
-- synthetic identity and an expiry; the cron sweep hard-deletes them past it.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "guestExpiresAt" DATETIME;

-- CreateIndex
CREATE INDEX "User_isGuest_guestExpiresAt_idx" ON "User"("isGuest", "guestExpiresAt");
