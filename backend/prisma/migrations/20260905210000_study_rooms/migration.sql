-- Study Buddy Rooms (PATHWISE 2.0 Phases 11/19 MVP). Purely additive.

-- CreateTable
CREATE TABLE "StudyRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "topicName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "helpAAt" DATETIME,
    "helpBAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "StudyRoom_aId_fkey" FOREIGN KEY ("aId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudyRoom_bId_fkey" FOREIGN KEY ("bId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyRoomMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudyRoomMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "StudyRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudyRoomMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyRoom_aId_bId_key" ON "StudyRoom"("aId", "bId");
CREATE INDEX "StudyRoomMessage_roomId_createdAt_idx" ON "StudyRoomMessage"("roomId", "createdAt");
