-- Drop half of the chore_completions rekey — see
-- …_rekey_chore_completions_backfill. Only run after confirming (by hand,
-- via psql) that occurrence_date agrees with iso_week for every
-- surviving row:
--
--   SELECT count(*) AS total, count(*) FILTER (
--     WHERE to_char(occurrence_date, 'IYYY-"W"IW') != iso_week
--   ) AS mismatches
--   FROM chore_completions WHERE iso_week IS NOT NULL;
--
-- Confirmed 0 mismatches before this migration was written (0 completions
-- existed in the dev database at the time; the test database was
-- exercised separately with synthetic orphan scenarios and reset before
-- this ran for real — see the backfill migration's orphan-cleanup guard).
-- Constraint name differs by datasource: the dev database was originally
-- created by Drizzle ("..._unique"), the test database by a straight
-- Prisma migration replay ("..._key") — same drift CLAUDE.md's Migration
-- history note documents elsewhere in this schema. IF EXISTS on both
-- names keeps this one file valid against either.
ALTER TABLE "chore_completions" DROP CONSTRAINT IF EXISTS "chore_completions_chore_id_iso_week_unique";
ALTER TABLE "chore_completions" DROP CONSTRAINT IF EXISTS "chore_completions_chore_id_iso_week_key";
ALTER TABLE "chore_completions" DROP COLUMN "iso_week";

-- The real uniqueness guarantee, replacing the dropped @@unique above.
-- subtask_id is nullable (NULL = "this chore has no subtasks"), and
-- Postgres treats every NULL as distinct in a normal unique index, so a
-- plain @@unique([choreId, subtaskId, occurrenceDate]) would not dedupe
-- the no-subtask case. Two partial indexes instead, one per case.
CREATE UNIQUE INDEX "chore_completions_chore_occurrence_no_subtask_key"
    ON "chore_completions" ("chore_id", "occurrence_date")
    WHERE "subtask_id" IS NULL;

CREATE UNIQUE INDEX "chore_completions_chore_subtask_occurrence_key"
    ON "chore_completions" ("chore_id", "subtask_id", "occurrence_date")
    WHERE "subtask_id" IS NOT NULL;
