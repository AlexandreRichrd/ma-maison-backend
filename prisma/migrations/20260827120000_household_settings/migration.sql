-- One row per household (in practice, at most one row ever — this app is
-- single-household), created lazily by SettingsService on the first
-- PATCH /settings, not by bootstrap-household.ts. Falls back to these same
-- defaults when the row doesn't exist yet, so a fresh install behaves
-- exactly as it did when these were env vars. See CLAUDE.md's Climate
-- alerts section (issue #11). CLIMATE_ALERT_HYSTERESIS_C stays an env var,
-- not a column here.
CREATE TABLE "household_settings" (
    "household_id" UUID NOT NULL,
    "climate_alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "climate_alert_margin_c" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "climate_alert_indoor_threshold_c" DOUBLE PRECISION NOT NULL DEFAULT 24,
    "climate_alert_cooldown_minutes" INTEGER NOT NULL DEFAULT 120,
    "climate_summary_retention_days" INTEGER NOT NULL DEFAULT 7,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_settings_pkey" PRIMARY KEY ("household_id")
);

-- AddForeignKey
ALTER TABLE "household_settings" ADD CONSTRAINT "household_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-user notification preference (issue #11) — defaults true
-- so every existing user keeps today's "everyone gets alerts" behaviour.
ALTER TABLE "users" ADD COLUMN "receive_climate_alerts" BOOLEAN NOT NULL DEFAULT true;
