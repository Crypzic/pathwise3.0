-- Study Buddy Matching (PATHWISE 2.0 Phase 10): buddy requests/pairs.
-- Purely additive.

-- CreateTable
CREATE TABLE "BuddyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "BuddyRequest_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BuddyRequest_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BuddyRequest_fromId_toId_key" ON "BuddyRequest"("fromId", "toId");
CREATE INDEX "BuddyRequest_toId_status_idx" ON "BuddyRequest"("toId", "status");
CREATE INDEX "BuddyRequest_fromId_status_idx" ON "BuddyRequest"("fromId", "status");
