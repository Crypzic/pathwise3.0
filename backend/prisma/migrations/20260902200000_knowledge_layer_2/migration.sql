-- Knowledge Layer 2.0 (PATHWISE 2.0 Phase 6): richer concept structure on
-- Topic. All columns nullable/defaulted so existing rows keep working.

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN "difficulty" REAL;
ALTER TABLE "Topic" ADD COLUMN "parentId" TEXT REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD COLUMN "objectivesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Topic" ADD COLUMN "misconceptionsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Topic" ADD COLUMN "prerequisitesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Topic" ADD COLUMN "sourceRef" TEXT;

-- CreateIndex
CREATE INDEX "Topic_parentId_idx" ON "Topic"("parentId");
