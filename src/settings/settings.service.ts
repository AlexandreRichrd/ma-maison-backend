import { Injectable } from '@nestjs/common';
import type { HouseholdSettings } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

export type EffectiveSettings = {
  climateAlertEnabled: boolean;
  climateAlertMarginC: number;
  climateAlertIndoorThresholdC: number;
  climateAlertCooldownMinutes: number;
  climateSummaryRetentionDays: number;
  // null means "no household-chosen label yet" — the frontend falls back
  // to its own hardcoded default (see settings-api.server.ts's
  // resolveSensorLabel() in my-home, issue #12).
  indoorSensorLabel: string | null;
  outdoorSensorLabel: string | null;
};

// Same defaults the four migrated env vars used to fall back to (see
// CLAUDE.md's Climate alerts section) — a fresh install, or any household
// that's never opened the settings page, must behave identically to
// before issue #11.
export const DEFAULT_SETTINGS: EffectiveSettings = {
  climateAlertEnabled: true,
  climateAlertMarginC: 0.5,
  climateAlertIndoorThresholdC: 24,
  climateAlertCooldownMinutes: 120,
  climateSummaryRetentionDays: 7,
  indoorSensorLabel: null,
  outdoorSensorLabel: null,
};

// This app is single-household (see CLAUDE.md) — getEffective() and
// update() both resolve *the* household directly rather than taking a
// householdId: there's exactly one, and the background callers
// (ClimateAlertTriggerService per ingested measurement,
// ClimateSummaryService's nightly cron) have no per-request household to
// scope by. Same assumption bootstrap-household.ts already makes.
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // No row yet (household never opened the settings page) -> hardcoded
  // defaults, not an error. Called fresh on every read — see
  // ClimateAlertTriggerService/ClimateSummaryService for why this needs to
  // be a live DB read rather than something cached at startup.
  async getEffective(): Promise<EffectiveSettings> {
    const household = await this.prisma.household.findFirst({
      include: { settings: true },
    });
    return household?.settings
      ? toEffectiveSettings(household.settings)
      : DEFAULT_SETTINGS;
  }

  // Upserts: the row may not exist yet. On create, unset DTO fields fall
  // back to the current effective (i.e. default) values rather than the
  // column defaults directly, so behaviour is identical either way; on
  // update, an unset DTO field is left out of `data` entirely (Prisma
  // treats `undefined` as "don't touch this column"), preserving whatever
  // that field was already set to.
  async update(dto: UpdateSettingsDto): Promise<EffectiveSettings> {
    const household = await this.prisma.household.findFirstOrThrow({
      include: { settings: true },
    });
    const current = household.settings
      ? toEffectiveSettings(household.settings)
      : DEFAULT_SETTINGS;
    // An empty-string label means "clear the override back to default".
    // The conditional spreads below only add the key at all when the DTO
    // actually provided it — an object literal with `key: undefined`
    // would still set that key (overwriting `current`'s real value with
    // undefined), unlike `dto` itself, whose absent optional fields are
    // genuinely missing keys, not present-with-undefined ones.
    const normalized = {
      ...dto,
      ...(dto.indoorSensorLabel !== undefined && {
        indoorSensorLabel: emptyToNull(dto.indoorSensorLabel),
      }),
      ...(dto.outdoorSensorLabel !== undefined && {
        outdoorSensorLabel: emptyToNull(dto.outdoorSensorLabel),
      }),
    };
    const merged: EffectiveSettings = { ...current, ...normalized };

    const row = await this.prisma.householdSettings.upsert({
      where: { householdId: household.id },
      create: { householdId: household.id, ...merged },
      update: { ...normalized },
    });
    return toEffectiveSettings(row);
  }
}

function emptyToNull(value: string | undefined): string | null | undefined {
  return value === '' ? null : value;
}

function toEffectiveSettings(row: HouseholdSettings): EffectiveSettings {
  return {
    climateAlertEnabled: row.climateAlertEnabled,
    climateAlertMarginC: row.climateAlertMarginC,
    climateAlertIndoorThresholdC: row.climateAlertIndoorThresholdC,
    climateAlertCooldownMinutes: row.climateAlertCooldownMinutes,
    climateSummaryRetentionDays: row.climateSummaryRetentionDays,
    indoorSensorLabel: row.indoorSensorLabel,
    outdoorSensorLabel: row.outdoorSensorLabel,
  };
}
