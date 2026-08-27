import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service';

describe('SettingsService', () => {
  let prisma: PrismaService;
  let settings: SettingsService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, household_settings RESTART IDENTITY CASCADE`;
    settings = new SettingsService(prisma);
  });

  async function seedHousehold() {
    return prisma.household.create({ data: { memberOrder: [] } });
  }

  describe('getEffective', () => {
    it('returns hardcoded defaults when no household exists yet', async () => {
      expect(await settings.getEffective()).toEqual(DEFAULT_SETTINGS);
    });

    it('returns hardcoded defaults when the household has never saved settings', async () => {
      await seedHousehold();
      expect(await settings.getEffective()).toEqual(DEFAULT_SETTINGS);
    });

    it('returns the stored row once one exists', async () => {
      const household = await seedHousehold();
      await prisma.householdSettings.create({
        data: {
          householdId: household.id,
          climateAlertEnabled: false,
          climateAlertMarginC: 1,
          climateAlertIndoorThresholdC: 22,
          climateAlertCooldownMinutes: 60,
          climateSummaryRetentionDays: 14,
        },
      });

      expect(await settings.getEffective()).toEqual({
        climateAlertEnabled: false,
        climateAlertMarginC: 1,
        climateAlertIndoorThresholdC: 22,
        climateAlertCooldownMinutes: 60,
        climateSummaryRetentionDays: 14,
      });
    });
  });

  describe('update', () => {
    it('creates the row on first update, filling unset fields with defaults', async () => {
      await seedHousehold();

      const result = await settings.update({ climateSummaryRetentionDays: 3 });

      expect(result).toEqual({
        ...DEFAULT_SETTINGS,
        climateSummaryRetentionDays: 3,
      });
    });

    it('preserves untouched fields on a later partial update', async () => {
      const household = await seedHousehold();
      await prisma.householdSettings.create({
        data: {
          householdId: household.id,
          climateAlertEnabled: true,
          climateAlertMarginC: 1,
          climateAlertIndoorThresholdC: 22,
          climateAlertCooldownMinutes: 60,
          climateSummaryRetentionDays: 14,
        },
      });

      const result = await settings.update({ climateAlertEnabled: false });

      expect(result).toEqual({
        climateAlertEnabled: false,
        climateAlertMarginC: 1,
        climateAlertIndoorThresholdC: 22,
        climateAlertCooldownMinutes: 60,
        climateSummaryRetentionDays: 14,
      });
    });
  });
});
