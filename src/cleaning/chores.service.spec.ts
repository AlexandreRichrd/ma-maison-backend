import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { ChoresService } from './chores.service';
import { HouseholdMembersService } from './household-members.service';

describe('ChoresService', () => {
  let prisma: PrismaService;
  let chores: ChoresService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_completions RESTART IDENTITY CASCADE`;
    chores = new ChoresService(prisma, new HouseholdMembersService(prisma));
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

  describe('create', () => {
    it('creates a chore with the given config', async () => {
      const { first } = await seedHouseholdOfTwo();

      const chore = await chores.create(first.id, {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });

      expect(chore).toMatchObject({
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorUserId: first.id,
      });
      expect(chore.anchorDate.toISOString().slice(0, 10)).toBe('2024-01-01');
    });

    it('creates a daily chore with any anchor date, no Monday constraint', async () => {
      const { first } = await seedHouseholdOfTwo();

      const chore = await chores.create(first.id, {
        name: 'Vaisselle',
        frequencyUnit: 'DAY',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        // A Wednesday — fine for a daily chore.
        anchorDate: '2024-01-03',
        anchorUserId: first.id,
      });

      expect(chore.frequencyUnit).toBe('DAY');
    });

    it('rejects a non-Monday anchorDate for a weekly chore', async () => {
      const { first } = await seedHouseholdOfTwo();

      await expect(
        chores.create(first.id, {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          // A Tuesday.
          anchorDate: '2024-01-02',
          anchorUserId: first.id,
        }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects an anchorUserId that is not a member of the caller’s household', async () => {
      const { first } = await seedHouseholdOfTwo();
      const otherHousehold = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const outsider = await prisma.user.create({
        data: {
          householdId: otherHousehold.id,
          email: 'outsider@example.com',
          passwordHash: 'x',
          name: 'Outsider',
          avatarKey: 'outsider',
          emailVerifiedAt: new Date(),
        },
      });

      await expect(
        chores.create(first.id, {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: '2024-01-01',
          anchorUserId: outsider.id,
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('update', () => {
    it('patches only the given fields, leaving the rest untouched', async () => {
      const { first } = await seedHouseholdOfTwo();
      const original = await chores.create(first.id, {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });

      const updated = await chores.update(first.id, original.id, {
        name: 'Cuisine et vaisselle',
      });

      expect(updated).toMatchObject({
        name: 'Cuisine et vaisselle',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorUserId: first.id,
      });
    });

    it('rejects switching to WEEK when the existing anchorDate is not a Monday', async () => {
      const { first } = await seedHouseholdOfTwo();
      const original = await chores.create(first.id, {
        name: 'Vaisselle',
        frequencyUnit: 'DAY',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        // A Wednesday — fine while frequencyUnit is DAY.
        anchorDate: '2024-01-03',
        anchorUserId: first.id,
      });

      await expect(
        chores.update(first.id, original.id, { frequencyUnit: 'WEEK' }),
      ).rejects.toThrow(ApiError);
    });

    it('allows switching to WEEK when a new Monday anchorDate is given in the same update', async () => {
      const { first } = await seedHouseholdOfTwo();
      const original = await chores.create(first.id, {
        name: 'Vaisselle',
        frequencyUnit: 'DAY',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-03',
        anchorUserId: first.id,
      });

      const updated = await chores.update(first.id, original.id, {
        frequencyUnit: 'WEEK',
        anchorDate: '2024-01-01',
      });

      expect(updated.frequencyUnit).toBe('WEEK');
    });

    it('rejects an anchorUserId that is not a member of the caller’s household', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const original = await chores.create(first.id, {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });
      const otherHousehold = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const outsider = await prisma.user.create({
        data: {
          householdId: otherHousehold.id,
          email: 'outsider@example.com',
          passwordHash: 'x',
          name: 'Outsider',
          avatarKey: 'outsider',
          emailVerifiedAt: new Date(),
        },
      });

      await expect(
        chores.update(first.id, original.id, { anchorUserId: outsider.id }),
      ).rejects.toThrow(ApiError);
      // Unaffected by the rejected update.
      const stillOwnedBySecond = await chores.update(first.id, original.id, {
        anchorUserId: second.id,
      });
      expect(stillOwnedBySecond.anchorUserId).toBe(second.id);
    });

    it('404s for an unknown chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await expect(
        chores.update(first.id, '00000000-0000-0000-0000-000000000000', {
          name: 'x',
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('remove', () => {
    it('deletes the chore and cascades its completions', async () => {
      const { first } = await seedHouseholdOfTwo();
      const chore = await chores.create(first.id, {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });
      await prisma.choreCompletion.create({
        data: { choreId: chore.id, userId: first.id, isoWeek: '2024-W01' },
      });

      await chores.remove(chore.id);

      expect(
        await prisma.chore.findUnique({ where: { id: chore.id } }),
      ).toBeNull();
      expect(
        await prisma.choreCompletion.findMany({ where: { choreId: chore.id } }),
      ).toEqual([]);
    });

    it('404s for an unknown chore', async () => {
      await expect(
        chores.remove('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('list', () => {
    it('returns every chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await chores.create(first.id, {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });
      await chores.create(first.id, {
        name: 'Draps',
        frequencyUnit: 'WEEK',
        frequencyValue: 2,
        assignmentMode: 'PINNED',
        anchorDate: '2024-01-01',
        anchorUserId: first.id,
      });

      const result = await chores.list();
      expect(result.map((c) => c.name).sort()).toEqual(['Cuisine', 'Draps']);
    });
  });
});
