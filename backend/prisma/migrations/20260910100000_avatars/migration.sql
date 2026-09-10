-- Profile pictures + selectable avatar frames. Purely additive.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarPath" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarFrame" TEXT NOT NULL DEFAULT 'classic';
