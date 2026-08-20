-- New table only — additive, nothing else touched. See CLAUDE.md's Chore
-- rotation section for the subtask completion semantics this feeds.
CREATE TABLE "chore_subtasks" (
    "id" UUID NOT NULL,
    "chore_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chore_subtasks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chore_subtasks"
    ADD CONSTRAINT "chore_subtasks_chore_id_fkey"
    FOREIGN KEY ("chore_id") REFERENCES "chores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "chore_subtasks_chore_id_idx" ON "chore_subtasks"("chore_id");
