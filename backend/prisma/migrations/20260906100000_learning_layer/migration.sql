-- Learning layer: cached topic breakdowns + two-phase quizzes with written
-- answers. Purely additive.

-- AlterTable: cached lecturer-style breakdown per topic.
ALTER TABLE "Topic" ADD COLUMN "breakdownJson" TEXT;
ALTER TABLE "Topic" ADD COLUMN "breakdownAt" DATETIME;

-- AlterTable: written-answer phase on quiz items.
ALTER TABLE "QuizItem" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'mcq';
ALTER TABLE "QuizItem" ADD COLUMN "referenceAnswer" TEXT;
ALTER TABLE "QuizItem" ADD COLUMN "writtenAnswer" TEXT;
ALTER TABLE "QuizItem" ADD COLUMN "verdict" TEXT;
