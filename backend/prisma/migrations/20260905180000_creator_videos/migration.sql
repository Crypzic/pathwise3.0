-- Hidden creator video infrastructure (PATHWISE 2.0 Phase 16). Built dark
-- behind FEATURE_USER_VIDEO_POSTING=false. Purely additive.

-- CreateTable
CREATE TABLE "CreatorVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER,
    "subject" TEXT,
    "topicsJson" TEXT NOT NULL DEFAULT '[]',
    "transcript" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreatorVideo_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreatorVideoEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "watchMs" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorVideoEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreatorVideoEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "CreatorVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreatorVideoComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorVideoComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "CreatorVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreatorVideoComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreatorFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "followerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreatorFollow_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CreatorVideo_creatorId_status_idx" ON "CreatorVideo"("creatorId", "status");
CREATE INDEX "CreatorVideo_status_visibility_moderationStatus_idx" ON "CreatorVideo"("status", "visibility", "moderationStatus");
CREATE INDEX "CreatorVideoEvent_videoId_kind_idx" ON "CreatorVideoEvent"("videoId", "kind");
CREATE INDEX "CreatorVideoEvent_userId_kind_idx" ON "CreatorVideoEvent"("userId", "kind");
CREATE INDEX "CreatorVideoComment_videoId_status_createdAt_idx" ON "CreatorVideoComment"("videoId", "status", "createdAt");
CREATE UNIQUE INDEX "CreatorFollow_followerId_creatorId_key" ON "CreatorFollow"("followerId", "creatorId");
CREATE INDEX "CreatorFollow_creatorId_idx" ON "CreatorFollow"("creatorId");
