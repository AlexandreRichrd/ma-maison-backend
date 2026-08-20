-- The application no longer populates frequency_weeks/anchor_iso_week (see
-- …_generalize_chore_frequency_backfill) — every new INSERT was violating
-- their NOT NULL constraint. Relax, don't drop: dropping is deferred to
-- …_generalize_chore_frequency_drop_old_columns until the backfill has
-- been verified. Existing rows keep their historical values; new rows
-- simply have NULL here, which is fine — nothing reads these columns
-- anymore, and the verification query for the drop step only compares
-- rows that have a value to compare.
ALTER TABLE "chores"
    ALTER COLUMN "frequency_weeks" DROP NOT NULL,
    ALTER COLUMN "anchor_iso_week" DROP NOT NULL;
