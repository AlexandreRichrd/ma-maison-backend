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
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_completions, chore_subtasks RESTART IDENTITY CASCADE`;
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
        data: {
          choreId: kitchen.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-01'),
        },
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
          occurrenceDate: '2024-01-01',
          done: true,
          subtasks: [],
        },
      ]);
      const secondEntry = result.find((r) => r.user.id === second.id);
      expect(secondEntry?.chores).toEqual([]);
    });

    it('never returns a DAY-unit chore, even one that would occur that day', async () => {
      const { first } = await seedHouseholdOfTwo();
      // 2024-01-01 is a Monday — this daily chore occurs every day,
      // including the Monday that starts ISO week 2024-W01.
      await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      const result = await cleaning.getWeek(first.id, '2024-W01');
      expect(result.flatMap((e) => e.chores)).toEqual([]);
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

    it('a chore with subtasks is done only once every subtask is completed', async () => {
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
      const sweep = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Balayer', position: 0 },
      });
      const wipe = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Essuyer', position: 1 },
      });
      await prisma.choreCompletion.create({
        data: {
          choreId: kitchen.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-01'),
          subtaskId: sweep.id,
        },
      });

      const partiallyDone = await cleaning.getWeek(first.id, '2024-W01');
      const kitchenPartial = partiallyDone
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(kitchenPartial?.done).toBe(false);
      expect(kitchenPartial?.subtasks).toEqual([
        { id: sweep.id, label: 'Balayer', done: true },
        { id: wipe.id, label: 'Essuyer', done: false },
      ]);

      await prisma.choreCompletion.create({
        data: {
          choreId: kitchen.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-01'),
          subtaskId: wipe.id,
        },
      });

      const fullyDone = await cleaning.getWeek(first.id, '2024-W01');
      const kitchenFull = fullyDone
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(kitchenFull?.done).toBe(true);
    });

    it('never exposes passwordHash on the returned users', async () => {
      const { first } = await seedHouseholdOfTwo();
      const result = await cleaning.getWeek(first.id, '2024-W01');
      expect(result[0].user).not.toHaveProperty('passwordHash');
    });
  });

  describe('getDay', () => {
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

      expect(await cleaning.getDay(user.id, '2026-08-20')).toEqual([]);
    });

    it('assigns occurring daily chores, both entries always present', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const dishes = await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      const result = await cleaning.getDay(first.id, '2024-01-01');

      expect(result.map((r) => r.user.id)).toEqual([first.id, second.id]);
      const firstEntry = result.find((r) => r.user.id === first.id);
      expect(firstEntry?.chores.map((c) => c.id)).toEqual([dishes.id]);
      const secondEntry = result.find((r) => r.user.id === second.id);
      expect(secondEntry?.chores).toEqual([]);
    });

    it('never returns a WEEK-unit chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      const result = await cleaning.getDay(first.id, '2024-01-01');
      expect(result.flatMap((e) => e.chores)).toEqual([]);
    });

    it('an every-N-days chore is absent on an off-day', async () => {
      const { first } = await seedHouseholdOfTwo();
      const watering = await prisma.chore.create({
        data: {
          name: 'Arroser',
          frequencyUnit: 'DAY',
          frequencyValue: 3,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });

      const onDay = await cleaning.getDay(first.id, '2024-01-01');
      const offDay = await cleaning.getDay(first.id, '2024-01-02');

      expect(onDay.flatMap((e) => e.chores.map((c) => c.id))).toContain(
        watering.id,
      );
      expect(offDay.flatMap((e) => e.chores.map((c) => c.id))).not.toContain(
        watering.id,
      );
    });

    it('both entries are empty, not absent, for a day before every chore’s anchor', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-06-01'),
          anchorUserId: first.id,
        },
      });

      const result = await cleaning.getDay(first.id, '2024-01-01');

      expect(result.map((entry) => entry.user.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(result.map((entry) => entry.chores)).toEqual([[], []]);
    });
  });

  describe('toggleCompletion — chore with no subtasks', () => {
    it('rejects an unknown chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await expect(
        cleaning.toggleCompletion(
          first.id,
          '00000000-0000-0000-0000-000000000000',
          '2024-01-01',
        ),
      ).rejects.toThrow(ApiError);
    });

    it('creates a completion assigned to whoever the current rotation assigns', async () => {
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

      await cleaning.toggleCompletion(second.id, kitchen.id, '2024-01-01');

      const completion = await prisma.choreCompletion.findFirstOrThrow({
        where: { choreId: kitchen.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(completion.userId).toBe(first.id);
      expect(completion.subtaskId).toBeNull();
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

      await cleaning.toggleCompletion(first.id, kitchen.id, '2024-01-01');
      await cleaning.toggleCompletion(first.id, kitchen.id, '2024-01-01');

      const completion = await prisma.choreCompletion.findFirst({
        where: { choreId: kitchen.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(completion).toBeNull();
    });

    it('rejects toggling a chore that is not scheduled that day', async () => {
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
        cleaning.toggleCompletion(first.id, sheets.id, '2024-01-08'),
      ).rejects.toThrow(ApiError);

      try {
        await cleaning.toggleCompletion(first.id, sheets.id, '2024-01-08');
      } catch (error) {
        expect((error as ApiError).getStatus()).toBe(409);
      }
    });

    it('still allows un-toggling a stale completion for a now-off occurrence', async () => {
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
        data: {
          choreId: sheets.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-08'),
        },
      });

      await cleaning.toggleCompletion(first.id, sheets.id, '2024-01-08');

      const completion = await prisma.choreCompletion.findFirst({
        where: { choreId: sheets.id, occurrenceDate: new Date('2024-01-08') },
      });
      expect(completion).toBeNull();
    });
  });

  describe('toggleCompletion — chore with subtasks', () => {
    async function seedChoreWithSubtasks(anchorUserId: string) {
      const chore = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId,
        },
      });
      const a = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'A', position: 0 },
      });
      const b = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'B', position: 1 },
      });
      return { chore, a, b };
    }

    it('ticking the parent creates a completion for every subtask', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const { chore, a, b } = await seedChoreWithSubtasks(first.id);

      await cleaning.toggleCompletion(second.id, chore.id, '2024-01-01');

      const completions = await prisma.choreCompletion.findMany({
        where: { choreId: chore.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(completions.map((c) => c.subtaskId).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(completions.every((c) => c.userId === first.id)).toBe(true);
    });

    it('toggling the parent again (fully done) removes every subtask completion', async () => {
      const { first } = await seedHouseholdOfTwo();
      const { chore } = await seedChoreWithSubtasks(first.id);

      await cleaning.toggleCompletion(first.id, chore.id, '2024-01-01');
      await cleaning.toggleCompletion(first.id, chore.id, '2024-01-01');

      const completions = await prisma.choreCompletion.findMany({
        where: { choreId: chore.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(completions).toEqual([]);
    });

    it('toggling the parent when only some subtasks are done completes the rest, not removes them', async () => {
      const { first } = await seedHouseholdOfTwo();
      const { chore, a, b } = await seedChoreWithSubtasks(first.id);
      await prisma.choreCompletion.create({
        data: {
          choreId: chore.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-01'),
          subtaskId: a.id,
        },
      });

      await cleaning.toggleCompletion(first.id, chore.id, '2024-01-01');

      const completions = await prisma.choreCompletion.findMany({
        where: { choreId: chore.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(completions.map((c) => c.subtaskId).sort()).toEqual(
        [a.id, b.id].sort(),
      );
    });

    it('rejects ticking a not-yet-completed chore that is not scheduled that day', async () => {
      const { first } = await seedHouseholdOfTwo();
      const { chore } = await seedChoreWithSubtasks(first.id);

      // A Tuesday — never a valid occurrence for a WEEK-unit chore,
      // regardless of frequencyValue (only the anchor-aligned Monday is).
      await expect(
        cleaning.toggleCompletion(first.id, chore.id, '2024-01-02'),
      ).rejects.toThrow(ApiError);
    });

    it('still allows un-toggling every subtask for a now-off occurrence', async () => {
      const { first } = await seedHouseholdOfTwo();
      const chore = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });
      const subtask = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'A', position: 0 },
      });
      await prisma.choreCompletion.create({
        data: {
          choreId: chore.id,
          userId: first.id,
          occurrenceDate: new Date('2024-01-08'),
          subtaskId: subtask.id,
        },
      });

      await cleaning.toggleCompletion(first.id, chore.id, '2024-01-08');

      const completions = await prisma.choreCompletion.findMany({
        where: { choreId: chore.id, occurrenceDate: new Date('2024-01-08') },
      });
      expect(completions).toEqual([]);
    });
  });

  describe('toggleSubtaskCompletion', () => {
    async function seedChoreWithSubtask(anchorUserId: string) {
      const chore = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId,
        },
      });
      const subtask = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'Balayer', position: 0 },
      });
      return { chore, subtask };
    }

    it('404s for an unknown chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      await expect(
        cleaning.toggleSubtaskCompletion(
          first.id,
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          '2024-01-01',
        ),
      ).rejects.toThrow(ApiError);
    });

    it('404s for a subtask that belongs to a different chore', async () => {
      const { first } = await seedHouseholdOfTwo();
      const { chore } = await seedChoreWithSubtask(first.id);
      const { subtask: foreignSubtask } = await seedChoreWithSubtask(first.id);

      await expect(
        cleaning.toggleSubtaskCompletion(
          first.id,
          chore.id,
          foreignSubtask.id,
          '2024-01-01',
        ),
      ).rejects.toThrow(ApiError);
    });

    it('toggles one subtask on and off, independent of the others', async () => {
      const { first, second } = await seedHouseholdOfTwo();
      const { chore, subtask } = await seedChoreWithSubtask(first.id);

      await cleaning.toggleSubtaskCompletion(
        second.id,
        chore.id,
        subtask.id,
        '2024-01-01',
      );
      const completion = await prisma.choreCompletion.findFirstOrThrow({
        where: {
          choreId: chore.id,
          subtaskId: subtask.id,
          occurrenceDate: new Date('2024-01-01'),
        },
      });
      expect(completion.userId).toBe(first.id);

      await cleaning.toggleSubtaskCompletion(
        second.id,
        chore.id,
        subtask.id,
        '2024-01-01',
      );
      const afterUntoggle = await prisma.choreCompletion.findFirst({
        where: {
          choreId: chore.id,
          subtaskId: subtask.id,
          occurrenceDate: new Date('2024-01-01'),
        },
      });
      expect(afterUntoggle).toBeNull();
    });

    it('unticking one subtask makes the chore no longer done, per getWeek', async () => {
      const { first } = await seedHouseholdOfTwo();
      const { chore } = await seedChoreWithSubtask(first.id);
      const secondSubtask = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'Essuyer', position: 1 },
      });
      const subtasks = await prisma.choreSubtask.findMany({
        where: { choreId: chore.id },
      });

      for (const subtask of subtasks) {
        await cleaning.toggleSubtaskCompletion(
          first.id,
          chore.id,
          subtask.id,
          '2024-01-01',
        );
      }
      const doneResult = await cleaning.getWeek(first.id, '2024-W01');
      expect(
        doneResult.flatMap((e) => e.chores).find((c) => c.id === chore.id)
          ?.done,
      ).toBe(true);

      await cleaning.toggleSubtaskCompletion(
        first.id,
        chore.id,
        secondSubtask.id,
        '2024-01-01',
      );
      const notDoneResult = await cleaning.getWeek(first.id, '2024-W01');
      expect(
        notDoneResult.flatMap((e) => e.chores).find((c) => c.id === chore.id)
          ?.done,
      ).toBe(false);
    });

    it('rejects ticking a subtask on a day the chore is not scheduled', async () => {
      const { first } = await seedHouseholdOfTwo();
      const chore = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: first.id,
        },
      });
      const subtask = await prisma.choreSubtask.create({
        data: { choreId: chore.id, label: 'A', position: 0 },
      });

      await expect(
        cleaning.toggleSubtaskCompletion(
          first.id,
          chore.id,
          subtask.id,
          '2024-01-08',
        ),
      ).rejects.toThrow(ApiError);
    });
  });
});
