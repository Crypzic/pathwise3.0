-- Built-in error tracking (beta readiness). Purely additive.

-- CreateTable
CREATE TABLE "ErrorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "url" TEXT,
    "requestId" TEXT,
    "userId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorReport_fingerprint_dayKey_key" ON "ErrorReport"("fingerprint", "dayKey");
CREATE INDEX "ErrorReport_lastSeenAt_idx" ON "ErrorReport"("lastSeenAt");
