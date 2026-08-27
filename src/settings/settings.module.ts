import { Module } from '@nestjs/common';

import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

// Owns household_settings (GET/PATCH /settings) — see CLAUDE.md's Climate
// alerts section (issue #11). Exported for ClimateModule, whose
// ClimateAlertTriggerService and ClimateSummaryService read effective
// settings instead of process.env.
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
