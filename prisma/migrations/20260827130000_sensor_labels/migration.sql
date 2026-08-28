-- Household-chosen display name per sensor role — null means "use the
-- frontend's hardcoded default". See CLAUDE.md's Climate alerts section
-- (issue #12).
ALTER TABLE "household_settings" ADD COLUMN "indoor_sensor_label" TEXT;
ALTER TABLE "household_settings" ADD COLUMN "outdoor_sensor_label" TEXT;
