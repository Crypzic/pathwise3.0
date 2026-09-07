-- Learner profile (PATHWISE 2.0 Phase 2): personalization signals collected
-- at onboarding, editable any time. Feeds recommendations and matching later.

-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "field" TEXT,
    "academicLevel" TEXT,
    "subjectsJson" TEXT NOT NULL DEFAULT '[]',
    "topicsJson" TEXT NOT NULL DEFAULT '[]',
    "contentPrefsJson" TEXT NOT NULL DEFAULT '[]',
    "communityInterestsJson" TEXT NOT NULL DEFAULT '[]',
    "studyStyle" TEXT,
    "buddyPrefsJson" TEXT NOT NULL DEFAULT '{}',
    "onboardedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_userId_key" ON "LearnerProfile"("userId");
