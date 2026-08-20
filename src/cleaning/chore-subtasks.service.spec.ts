import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { ChoreSubtasksService } from './chore-subtasks.service';

describe('ChoreSubtasksService', () => {
  let prisma: PrismaService;
  let subtasks: ChoreSubtasksService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_subtasks RESTART IDENTITY CASCADE`;
    subtasks = new ChoreSubtasksService(prisma);
  });

  let seedCount = 0;

  async function seedChore() {
    seedCount += 1;
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        email: `mia-${seedCount}@example.com`,
        passwordHash: 'x',
        name: 'Mia',
        avatarKey: 'mia',
        emailVerifiedAt: new Date(),
      },
    });
    const chore = await prisma.chore.create({
      data: {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: new Date('2024-01-01'),
        anchorUserId: user.id,
      },
    });
    return { chore, user };
  }

  describe('add', () => {
    it('appends a subtask at the next position', async () => {
      const { chore } = await seedChore();

      const first = await subtasks.add(chore.id, {
        label: 'Vider le lave-vaisselle',
      });
      const second = await subtasks.add(chore.id, {
        label: 'Essuyer les surfaces',
      });

      expect(first.position).toBe(0);
      expect(second.position).toBe(1);
    });

    it('404s for an unknown chore', async () => {
      await expect(
        subtasks.add('00000000-0000-0000-0000-000000000000', { label: 'x' }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('update', () => {
    it('updates only the label', async () => {
      const { chore } = await seedChore();
      const subtask = await subtasks.add(chore.id, { label: 'Original' });

      const updated = await subtasks.update(chore.id, subtask.id, {
        label: 'Renamed',
      });

      expect(updated.label).toBe('Renamed');
      expect(updated.position).toBe(0);
    });

    it('404s for a subtask that belongs to a different chore', async () => {
      const { chore } = await seedChore();
      const { chore: otherChore } = await seedChore();
      const subtask = await subtasks.add(otherChore.id, { label: 'x' });

      await expect(
        subtasks.update(chore.id, subtask.id, { label: 'y' }),
      ).rejects.toThrow(ApiError);
    });

    it('404s for an unknown subtask', async () => {
      const { chore } = await seedChore();
      await expect(
        subtasks.update(chore.id, '00000000-0000-0000-0000-000000000000', {
          label: 'y',
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('remove', () => {
    it('deletes the subtask', async () => {
      const { chore } = await seedChore();
      const subtask = await subtasks.add(chore.id, { label: 'x' });

      await subtasks.remove(chore.id, subtask.id);

      expect(
        await prisma.choreSubtask.findUnique({ where: { id: subtask.id } }),
      ).toBeNull();
    });

    it('404s for a subtask that belongs to a different chore', async () => {
      const { chore } = await seedChore();
      const { chore: otherChore } = await seedChore();
      const subtask = await subtasks.add(otherChore.id, { label: 'x' });

      await expect(subtasks.remove(chore.id, subtask.id)).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe('reorder', () => {
    it('applies the given order via position', async () => {
      const { chore } = await seedChore();
      const a = await subtasks.add(chore.id, { label: 'A' });
      const b = await subtasks.add(chore.id, { label: 'B' });
      const c = await subtasks.add(chore.id, { label: 'C' });

      const result = await subtasks.reorder(chore.id, {
        subtaskIds: [c.id, a.id, b.id],
      });

      expect(result.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
      expect(result.map((s) => s.position)).toEqual([0, 1, 2]);
    });

    it('rejects a set missing an existing subtask', async () => {
      const { chore } = await seedChore();
      const a = await subtasks.add(chore.id, { label: 'A' });
      await subtasks.add(chore.id, { label: 'B' });

      await expect(
        subtasks.reorder(chore.id, { subtaskIds: [a.id] }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects a set containing a subtask from another chore', async () => {
      const { chore } = await seedChore();
      const { chore: otherChore } = await seedChore();
      const a = await subtasks.add(chore.id, { label: 'A' });
      const foreign = await subtasks.add(otherChore.id, { label: 'Foreign' });

      await expect(
        subtasks.reorder(chore.id, { subtaskIds: [a.id, foreign.id] }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects a set with a duplicated id', async () => {
      const { chore } = await seedChore();
      const a = await subtasks.add(chore.id, { label: 'A' });
      await subtasks.add(chore.id, { label: 'B' });

      await expect(
        subtasks.reorder(chore.id, { subtaskIds: [a.id, a.id] }),
      ).rejects.toThrow(ApiError);
    });
  });
});
