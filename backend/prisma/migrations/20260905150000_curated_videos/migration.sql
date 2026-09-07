-- Curated Educational Videos (PATHWISE 2.0 Phase 14): editorial catalog +
-- engagement signals for the future FYP. Purely additive.

-- CreateTable
CREATE TABLE "CuratedVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "subject" TEXT NOT NULL,
    "topicsJson" TEXT NOT NULL DEFAULT '[]',
    "difficulty" REAL,
    "durationSec" INTEGER,
    "transcript" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VideoEngagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoEngagement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoEngagement_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "CuratedVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CuratedVideo_status_subject_idx" ON "CuratedVideo"("status", "subject");
CREATE INDEX "VideoEngagement_userId_kind_idx" ON "VideoEngagement"("userId", "kind");
CREATE INDEX "VideoEngagement_videoId_kind_idx" ON "VideoEngagement"("videoId", "kind");
