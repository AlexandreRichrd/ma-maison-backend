-- Hand-written (see CLAUDE.md's Migration history note — prisma migrate
-- dev's shadow-database diff isn't trustworthy against this datasource).
--
-- 1) recipe_ingredients.unit / shopping_items.unit go from free-text
--    String to a closed enum, so "g" and "grammes" can no longer diverge
--    into separate shopping-list rows. Existing values are mapped by the
--    CASE below; anything unrecognized falls back to 'UNITE' rather than
--    failing the migration.
-- 2) recipes.instructions (free-text) is replaced by recipe_steps, an
--    ordered child table mirroring recipe_ingredients/chore_subtasks.
--    Existing instructions are split on ',' into ordered steps.

CREATE TYPE "unit" AS ENUM (
    'G',
    'KG',
    'ML',
    'L',
    'CUILLERE_A_CAFE',
    'CUILLERE_A_SOUPE',
    'PINCEE',
    'GOUSSE',
    'TRANCHE',
    'SACHET',
    'PAQUET',
    'BOITE',
    'POT',
    'BOUTEILLE',
    'TETE',
    'DOUZAINE',
    'MICHE',
    'UNITE'
);

ALTER TABLE "recipe_ingredients"
    ALTER COLUMN "unit" TYPE "unit"
    USING (
        CASE lower(btrim("unit"))
            WHEN '' THEN 'UNITE'
            WHEN 'g' THEN 'G'
            WHEN 'kg' THEN 'KG'
            WHEN 'ml' THEN 'ML'
            WHEN 'l' THEN 'L'
            WHEN 'cuillère à café' THEN 'CUILLERE_A_CAFE'
            WHEN 'cuillere a cafe' THEN 'CUILLERE_A_CAFE'
            WHEN 'c. à café' THEN 'CUILLERE_A_CAFE'
            WHEN 'cuillère à soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'cuillere a soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'c. à soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'pincée' THEN 'PINCEE'
            WHEN 'pincee' THEN 'PINCEE'
            WHEN 'gousse' THEN 'GOUSSE'
            WHEN 'gousses' THEN 'GOUSSE'
            WHEN 'tranche' THEN 'TRANCHE'
            WHEN 'tranches' THEN 'TRANCHE'
            WHEN 'sachet' THEN 'SACHET'
            WHEN 'sachets' THEN 'SACHET'
            WHEN 'paquet' THEN 'PAQUET'
            WHEN 'paquets' THEN 'PAQUET'
            WHEN 'boîte' THEN 'BOITE'
            WHEN 'boite' THEN 'BOITE'
            WHEN 'boîtes' THEN 'BOITE'
            WHEN 'boites' THEN 'BOITE'
            WHEN 'pot' THEN 'POT'
            WHEN 'pots' THEN 'POT'
            WHEN 'bouteille' THEN 'BOUTEILLE'
            WHEN 'bouteilles' THEN 'BOUTEILLE'
            WHEN 'tête' THEN 'TETE'
            WHEN 'tete' THEN 'TETE'
            WHEN 'têtes' THEN 'TETE'
            WHEN 'tetes' THEN 'TETE'
            WHEN 'douzaine' THEN 'DOUZAINE'
            WHEN 'douzaines' THEN 'DOUZAINE'
            WHEN 'miche' THEN 'MICHE'
            WHEN 'miches' THEN 'MICHE'
            ELSE 'UNITE'
        END
    )::"unit";

ALTER TABLE "shopping_items"
    ALTER COLUMN "unit" TYPE "unit"
    USING (
        CASE lower(btrim("unit"))
            WHEN '' THEN 'UNITE'
            WHEN 'g' THEN 'G'
            WHEN 'kg' THEN 'KG'
            WHEN 'ml' THEN 'ML'
            WHEN 'l' THEN 'L'
            WHEN 'cuillère à café' THEN 'CUILLERE_A_CAFE'
            WHEN 'cuillere a cafe' THEN 'CUILLERE_A_CAFE'
            WHEN 'c. à café' THEN 'CUILLERE_A_CAFE'
            WHEN 'cuillère à soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'cuillere a soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'c. à soupe' THEN 'CUILLERE_A_SOUPE'
            WHEN 'pincée' THEN 'PINCEE'
            WHEN 'pincee' THEN 'PINCEE'
            WHEN 'gousse' THEN 'GOUSSE'
            WHEN 'gousses' THEN 'GOUSSE'
            WHEN 'tranche' THEN 'TRANCHE'
            WHEN 'tranches' THEN 'TRANCHE'
            WHEN 'sachet' THEN 'SACHET'
            WHEN 'sachets' THEN 'SACHET'
            WHEN 'paquet' THEN 'PAQUET'
            WHEN 'paquets' THEN 'PAQUET'
            WHEN 'boîte' THEN 'BOITE'
            WHEN 'boite' THEN 'BOITE'
            WHEN 'boîtes' THEN 'BOITE'
            WHEN 'boites' THEN 'BOITE'
            WHEN 'pot' THEN 'POT'
            WHEN 'pots' THEN 'POT'
            WHEN 'bouteille' THEN 'BOUTEILLE'
            WHEN 'bouteilles' THEN 'BOUTEILLE'
            WHEN 'tête' THEN 'TETE'
            WHEN 'tete' THEN 'TETE'
            WHEN 'têtes' THEN 'TETE'
            WHEN 'tetes' THEN 'TETE'
            WHEN 'douzaine' THEN 'DOUZAINE'
            WHEN 'douzaines' THEN 'DOUZAINE'
            WHEN 'miche' THEN 'MICHE'
            WHEN 'miches' THEN 'MICHE'
            ELSE 'UNITE'
        END
    )::"unit";

CREATE TABLE "recipe_steps" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "recipe_steps"
    ADD CONSTRAINT "recipe_steps_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "recipe_steps_recipe_id_idx" ON "recipe_steps"("recipe_id");

-- Backfill: split each recipe's free-text instructions on ',' into
-- ordered steps. Positions are computed with row_number() (not the raw
-- split ordinality) so a filtered-out blank piece never leaves a gap.
WITH split_steps AS (
    SELECT
        r.id AS recipe_id,
        regexp_replace(btrim(step), '\.$', '') AS text,
        ord
    FROM "recipes" r,
        unnest(string_to_array(r.instructions, ',')) WITH ORDINALITY AS s(step, ord)
    WHERE btrim(step) <> ''
)
INSERT INTO "recipe_steps" ("id", "recipe_id", "text", "position", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    recipe_id,
    text,
    (row_number() OVER (PARTITION BY recipe_id ORDER BY ord) - 1)::int,
    now(),
    now()
FROM split_steps;

ALTER TABLE "recipes" DROP COLUMN "instructions";
