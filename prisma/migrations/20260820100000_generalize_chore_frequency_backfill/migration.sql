-- Generalize chores.frequency_weeks/anchor_iso_week into a unit-agnostic
-- frequency_unit/frequency_value/anchor_date, so a chore can occur every N
-- days as well as every N weeks. See CLAUDE.md's Chore rotation section.
--
-- Backfill-only half of this change. Deliberately does NOT drop
-- frequency_weeks/anchor_iso_week — that happens in a later migration
-- (…_generalize_chore_frequency_drop_old_columns), once the backfill below
-- has been verified against the old columns. Losing anchor_iso_week before
-- that verification runs would make the ISO-week-to-date conversion
-- irreversible except from a dump.

-- CreateEnum
CREATE TYPE "frequency_unit" AS ENUM ('DAY', 'WEEK');

-- AlterTable: add new columns nullable first, backfill, then tighten.
ALTER TABLE "chores"
    ADD COLUMN "frequency_unit" "frequency_unit",
    ADD COLUMN "frequency_value" INTEGER,
    ADD COLUMN "anchor_date" DATE;

-- Every existing chore is weekly today (frequency_weeks is 1 or 2, never
-- day-based — daily chores are new in this migration). anchor_date is the
-- Monday of anchor_iso_week: to_date's IYYY/IW/ID format codes parse an
-- ISO (year, week, weekday) triple back into a real date when given
-- together — ID=1 pins the Monday. Verified by hand against 2024-W01 and
-- the 2026-W53 year-boundary case before writing this migration.
UPDATE "chores" SET
    "frequency_unit" = 'WEEK',
    "frequency_value" = "frequency_weeks",
    "anchor_date" = to_date(
        substring("anchor_iso_week" from 1 for 4) || substring("anchor_iso_week" from 7 for 2) || '1',
        'IYYYIWID'
    );

-- AlterTable: tighten now that every row has a value.
ALTER TABLE "chores"
    ALTER COLUMN "frequency_unit" SET NOT NULL,
    ALTER COLUMN "frequency_value" SET NOT NULL,
    ALTER COLUMN "anchor_date" SET NOT NULL;
