import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CleaningService } from './cleaning.service';
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
    cleaning = new CleaningService(prisma, new RotationService());
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
        role: 'Adulte',
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
        role: 'Adulte',
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
          role: 'Adulte',
          avatarKey: 'solo',
          emailVerifiedAt: new Date(),
        },
      });

      expect(await cleaning.getWeek(user.id, '2026-W32')).toEqual([]);
    });

    it('splits chores by rotation group per user, marking completions done', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const kitchen = await prisma.chore.create({
        data: { name: 'Cuisine', rotationGroup: 'A' },
      });
      await prisma.chore.create({
        data: { name: 'Salle de bain', rotationGroup: 'B' },
      });
      await prisma.choreCompletion.create({
        data: { choreId: kitchen.id, userId: first.id, isoWeek: '2024-W01' },
      });

      const result = await cleaning.getWeek(first.id, '2024-W01');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.user.id)).toEqual([first.id, second.id]);
      const firstEntry = result.find((r) => r.user.id === first.id);
      expect(firstEntry?.chores).toEqual([
        { id: kitchen.id, name: 'Cuisine', frequency: 'weekly', done: true },
      ]);
      const secondEntry = result.find((r) => r.user.id === second.id);
      expect(secondEntry?.chores[0]).toMatchObject({
        frequency: 'weekly',
        done: false,
      });
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

    it('creates a completion assigned to whichever user holds that rotation group this week', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const kitchen = await prisma.chore.create({
        data: { name: 'Cuisine', rotationGroup: 'A' },
      });

      // Week 1: weeklyGroup A goes to the household's first member.
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
        data: { name: 'Cuisine', rotationGroup: 'A' },
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
  });
});
