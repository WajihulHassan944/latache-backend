-- AlterTable
-- Per-skill years of experience was never stored: UserServices only carried
-- hourlyRate, so the "Activate a New Skill" / edit-skill years-of-experience
-- slider had nowhere backend-side to persist to and callers fell back to the
-- overall tasker business profile's yearsOfExperience column instead,
-- silently overwriting the wrong value.
ALTER TABLE "UserServices" ADD COLUMN "yearsOfExperience" INTEGER;
