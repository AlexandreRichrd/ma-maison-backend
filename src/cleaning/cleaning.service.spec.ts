import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CleaningService } from './cleaning.service';
import { HouseholdMembersService } from './household-members.service';
import { RotationService } from './rotation.service';

describe('CleaningService', () => {
  let prisma: PrismaService;
  let cleaning: CleaningService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_completions RESTART IDENTITY CASCADE`;
    cleaning = new CleaningService(
      prisma,
      new RotationService(),
      new HouseholdMembersService(prisma),
    );
  });

  async function seedHouseholdOfTwo() {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const first = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'mia@example.com',
        passwordHash: 'x',
        name: 'Mia',
        avatarKey: 'mia',
        emailVerifiedAt: new Date(),
      },
    });
    const second = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'sam@example.com',
        passwordHash: 'x',
        name: 'Sam',
        avatarKey: 'sam',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [first.id, second.id] },
    });
    return { household, first, second };
  }

  describe('getWeek', () => {
    it('returns [] when the household has fewer than two users', async () => {
      const household = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const user = await prisma.user.create({
        data: {
          householdId: household.id,
          email: 'solo@example.com',
          passwordHash: 'x',
          name: 'Solo',
          avatarKey: 'solo',
          emailVerifiedAt: new Date(),
        },
      });

      expect(await cleaning.getWeek(user.id, '2026-W32')).toEqual([]);
    });

    it('assigns occurring chores per rotation.service.ts, marking completions done', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });
      await prisma.choreCompletion.create({
        data: { choreId: kitchen.id, userId: first.id, isoWeek: '2024-W01' },
      });

      const result = await cleaning.getWeek(first.id, '2024-W01');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.user.id)).toEqual([first.id, second.id]);
      const firstEntry = result.find((r) => r.user.id === first.id);
      expect(firstEntry?.chores).toEqual([
        {
          id: kitchen.id,
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          done: true,
        },
      ]);
      const secondEntry = result.find((r) => r.user.id === second.id);
      expect(secondEntry?.chores).toEqual([]);
    });

    it('both user entries are always present, even with an empty chores array', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      // A chore anchored far in the future never occurs — no chore rows at
      // all this week, but both columns should still render.
      await prisma.chore.create({
        data: {
          name: 'Some day',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2029-12-31'),
          anchorUserId: first.id,
        },
      });

      const result = await cleaning.getWeek(first.id, '2024-W01');

      expect(result.map((entry) => entry.user.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(result.map((entry) => entry.chores)).toEqual([[], []]);
    });

    it('a biweekly chore is absent (not just empty) on its off-week', async () => {
      const { first } = await seedHouseholdOfTwo();
      const sheets = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      const onWeek = await cleaning.getWeek(first.id, '2024-W01');
      const offWeek = await cleaning.getWeek(first.id, '2024-W02');

      expect(onWeek.flatMap((e) => e.chores.map((c) => c.id))).toContain(
        sheets.id,
      );
      expect(offWeek.flatMap((e) => e.chores.map((c) => c.id))).not.toContain(
        sheets.id,
      );
    });

    it('a pinned chore always lands under the same user', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      await prisma.chore.create({
        data: {
          name: 'Poubelles',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'PINNED',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: second.id,
        },
      });

      const week1 = await cleaning.getWeek(first.id, '2024-W01');
      const week2 = await cleaning.getWeek(first.id, '2024-W02');

      const owner = (result: typeof week1) =>
        result.find((e) => e.chores.length > 0)?.user.id;
      expect(owner(week1)).toBe(second.id);
      expect(owner(week2)).toBe(second.id);
    });

    it('never exposes passwordHash on the returned users', async () => {
      const { first } = await seedHouseholdOfTwo();
      const result = await cleaning.getWeek(first.id, '2024-W01');
      expect(result[0].user).not.toHaveProperty('passwordHash');
    });
  });

  describe('toggleCompletion', () => {
    it('rejects an unknown chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await expect(
        cleaning.toggleCompletion(
          first.id,
          '00000000-0000-0000-0000-000000000000',
          '2024-W01',
        ),
      ).rejects.toThrow(ApiError);
    });

    it('creates a completion assigned to whoever the current rotation assigns that week', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      await cleaning.toggleCompletion(second.id, kitchen.id, '2024-W01');

      const completion = await prisma.choreCompletion.findUniqueOrThrow({
        where: {
          choreId_isoWeek: { choreId: kitchen.id, isoWeek: '2024-W01' },
        },
      });
      expect(completion.userId).toBe(first.id);
    });

    it('toggling twice removes the completion', async () => {
      const { first } = await seedHouseholdOfTwo();
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      await cleaning.toggleCompletion(first.id, kitchen.id, '2024-W01');
      await cleaning.toggleCompletion(first.id, kitchen.id, '2024-W01');

      const completion = await prisma.choreCompletion.findUnique({
        where: {
          choreId_isoWeek: { choreId: kitchen.id, isoWeek: '2024-W01' },
        },
      });
      expect(completion).toBeNull();
    });

    it('rejects toggling a chore that is not scheduled this week', async () => {
      const { first } = await seedHouseholdOfTwo();
      const sheets = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      await expect(
        cleaning.toggleCompletion(first.id, sheets.id, '2024-W02'),
      ).rejects.toThrow(ApiError);

      try {
        await cleaning.toggleCompletion(first.id, sheets.id, '2024-W02');
      } catch (error) {
        expect((error as ApiError).getStatus()).toBe(409);
      }
    });

    it('still allows un-toggling a stale completion for a now-off week', async () => {
      const { first } = await seedHouseholdOfTwo();
      const sheets = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });
      // A completion that predates the chore becoming biweekly (simulating
      // a stale row from before a frequency edit).
      await prisma.choreCompletion.create({
        data: { choreId: sheets.id, userId: first.id, isoWeek: '2024-W02' },
      });

      await cleaning.toggleCompletion(first.id, sheets.id, '2024-W02');

      const completion = await prisma.choreCompletion.findUnique({
        where: {
          choreId_isoWeek: { choreId: sheets.id, isoWeek: '2024-W02' },
        },
      });
      expect(completion).toBeNull();
    });
  });
});
