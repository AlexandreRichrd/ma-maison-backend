-- One row per (device, measure type, Europe/Paris calendar day), written
-- nightly by ClimateSummaryService from that day's raw measures and kept
-- indefinitely, unlike measures itself (see CLIMATE_SUMMARY_RETENTION_DAYS).
CREATE TABLE "daily_summaries" (
    "id" UUID NOT NULL,
    "device_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "min" DECIMAL NOT NULL,
    "max" DECIMAL NOT NULL,
    "avg" DECIMAL NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_summaries_device_name_type_date_key" ON "daily_summaries"("device_name", "type", "date");
