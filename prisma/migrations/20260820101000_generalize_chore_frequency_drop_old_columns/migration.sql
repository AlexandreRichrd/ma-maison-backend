-- Drop half of the chore frequency generalization — see
-- …_generalize_chore_frequency_backfill and
-- …_relax_old_chore_frequency_columns. Only run after confirming (by hand,
-- via psql) that frequency_value/anchor_date agree with
-- frequency_weeks/anchor_iso_week for every row:
--
--   SELECT count(*) AS total_chores,
--          count(*) FILTER (
--            WHERE frequency_value != frequency_weeks
--               OR frequency_unit != 'WEEK'
--               OR to_char(anchor_date, 'IYYY-"W"IW') != anchor_iso_week
--          ) AS mismatches
--   FROM chores;
--
-- Confirmed 0 mismatches out of 7 chores against the dev database before
-- this migration was written. Irreversible past this point except from a
-- backup — anchor_iso_week's exact stored format is gone once dropped.
ALTER TABLE "chores"
    DROP COLUMN "frequency_weeks",
    DROP COLUMN "anchor_iso_week";
