-- One row per MQTT reading forwarded by the household's Pi bridge. type is
-- plain text, not an enum, so a new sensor kind needs no migration.
CREATE TABLE "measures" (
    "id" UUID NOT NULL,
    "device_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measures_device_name_type_recorded_at_idx" ON "measures"("device_name", "type", "recorded_at");
