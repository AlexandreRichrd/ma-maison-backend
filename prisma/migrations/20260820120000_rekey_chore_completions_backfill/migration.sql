-- Rekey chore_completions from an iso_week string to an occurrence_date
-- (the calendar date the occurrence starts, anchor-aligned — see
-- CLAUDE.md's Chore rotation section), plus an optional subtask_id for
-- per-subtask completion. Backfill-only half of this change, same
-- deliberate split as …_generalize_chore_frequency_backfill /
-- …_drop_old_columns: iso_week stays in the DB (just relaxed to nullable)
-- until the backfill below is verified — dropping it is a later,
-- separate migration.
--
-- Wrapped in an explicit transaction so the orphan-cleanup guard below
-- can safely abort everything in this file, not just itself.
BEGIN;

-- AlterTable: add new columns nullable first, backfill, then tighten.
ALTER TABLE "chore_completions"
    ADD COLUMN "occurrence_date" DATE,
    ADD COLUMN "subtask_id" UUID;

ALTER TABLE "chore_completions"
    ADD CONSTRAINT "chore_completions_subtask_id_fkey"
    FOREIGN KEY ("subtask_id") REFERENCES "chore_subtasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monday of iso_week — same to_date(...,'IYYYIWID') conversion verified
-- against 2024-W01 and the 2026-W53 year-boundary case in the frequency
-- migration. subtask_id stays NULL for every existing row: no subtasks
-- existed before this feature, so every historical completion is a
-- whole-chore completion.
UPDATE "chore_completions" SET
    "occurrence_date" = to_date(
        substring("iso_week" from 1 for 4) || substring("iso_week" from 7 for 2) || '1',
        'IYYYIWID'
    );

-- Diagnostic + guarded cleanup: a completion recorded before a chore's
-- schedule changed (e.g. a chore that used to be weekly and is now
-- biweekly) can have a backfilled occurrence_date that no longer lines up
-- with the chore's *current* schedule — invisible, orphaned history that
-- would silently skew anything reading chore_completions later. Delete
-- them if there are few (expected: leftover seed/dev data, not real
-- history); abort this entire migration for manual review instead of
-- guessing if there are many.
DO $$
DECLARE
    orphan_count INT;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM chore_completions cc
    JOIN chores c ON c.id = cc.chore_id
    WHERE cc.subtask_id IS NULL
      AND (
        cc.occurrence_date < c.anchor_date
        OR (cc.occurrence_date - c.anchor_date) %
           (CASE WHEN c.frequency_unit = 'WEEK' THEN c.frequency_value * 7 ELSE c.frequency_value END) != 0
      );

    RAISE NOTICE 'Orphaned chore_completions rows (occurrence_date does not match the chore''s current schedule): %', orphan_count;

    IF orphan_count > 20 THEN
        RAISE EXCEPTION 'Too many orphaned chore_completions rows (%) to auto-delete — investigate manually (likely real history from a schedule change) before rerunning this migration.', orphan_count;
    END IF;

    DELETE FROM chore_completions cc
    USING chores c
    WHERE cc.chore_id = c.id
      AND cc.subtask_id IS NULL
      AND (
        cc.occurrence_date < c.anchor_date
        OR (cc.occurrence_date - c.anchor_date) %
           (CASE WHEN c.frequency_unit = 'WEEK' THEN c.frequency_value * 7 ELSE c.frequency_value END) != 0
      );
END $$;

-- AlterTable: tighten now that every remaining row has a value.
-- subtask_id stays nullable by design — NULL means "this chore has no
-- subtasks", not "not yet populated".
ALTER TABLE "chore_completions"
    ALTER COLUMN "occurrence_date" SET NOT NULL;

-- The application stops populating iso_week from here on (writes are now
-- occurrence_date/subtask_id-keyed) — relax it so new completions can
-- still be inserted. Dropping iso_week itself is deferred to
-- …_rekey_chore_completions_drop_iso_week, once this backfill is verified.
ALTER TABLE "chore_completions"
    ALTER COLUMN "iso_week" DROP NOT NULL;

COMMIT;
