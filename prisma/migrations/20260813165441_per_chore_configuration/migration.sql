-- Replace the fixed A/B/C/D rotation groups with per-chore configuration.
--
-- Backfill note: existing chores keep the assignment the old algorithm
-- already gave them at ROTATION_EPOCH ('2024-W01') going forward, with one
-- deliberate exception — the old C/D ("biweekly") chores appeared *every*
-- week with only the assignee swapping every 2 weeks; under the new model
-- they become genuinely biweekly (invisible on off-weeks). See
-- CLAUDE.md's Chore rotation section.

-- CreateEnum
CREATE TYPE "assignment_mode" AS ENUM ('ROTATING', 'PINNED');

-- AlterTable: add new columns nullable first, backfill, then tighten.
ALTER TABLE "chores"
    ADD COLUMN "frequency_weeks" INTEGER,
    ADD COLUMN "assignment_mode" "assignment_mode",
    ADD COLUMN "anchor_iso_week" TEXT,
    ADD COLUMN "anchor_user_id" UUID;

-- Backfill from rotation_group + the single household row's member_order
-- (Postgres arrays are 1-indexed). A/C anchor on the first member, B/D on
-- the second — same pairing the old algorithm used at the epoch week.
UPDATE "chores" SET
    "frequency_weeks" = CASE WHEN "rotation_group" IN ('A', 'B') THEN 1 ELSE 2 END,
    "assignment_mode" = 'ROTATING',
    "anchor_iso_week" = '2024-W01',
    "anchor_user_id" = (
        SELECT CASE WHEN "chores"."rotation_group" IN ('A', 'C')
            THEN h."member_order"[1]
            ELSE h."member_order"[2]
        END
        FROM "households" h
        LIMIT 1
    );

-- AlterTable: tighten now that every row has a value.
ALTER TABLE "chores"
    ALTER COLUMN "frequency_weeks" SET NOT NULL,
    ALTER COLUMN "assignment_mode" SET NOT NULL,
    ALTER COLUMN "anchor_iso_week" SET NOT NULL,
    ALTER COLUMN "anchor_user_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "chores" ADD CONSTRAINT "chores_anchor_user_id_fkey" FOREIGN KEY ("anchor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropColumn / DropEnum: the old fixed groups are gone.
ALTER TABLE "chores" DROP COLUMN "rotation_group";
DROP TYPE "rotation_group";
