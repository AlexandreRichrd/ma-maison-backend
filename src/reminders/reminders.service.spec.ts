import { addDays, subDays } from 'date-fns';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from './reminders.service';

describe('RemindersService', () => {
  let prisma: PrismaService;
  let reminders: RemindersService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE reminders, households, users RESTART IDENTITY CASCADE`;
    reminders = new RemindersService(prisma);
  });

  async function seedUser() {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    return prisma.user.create({
      data: {
        householdId: household.id,
        email: 'mia@example.com',
        passwordHash: 'x',
        name: 'Mia',
        avatarKey: 'mia',
        emailVerifiedAt: new Date(),
      },
    });
  }

  describe('list', () => {
    it('returns every reminder ordered by dueAt', async () => {
      const later = await prisma.reminder.create({
        data: {
          title: 'Later',
          dueAt: addDays(new Date(), 2),
          assigneeIds: [],
        },
      });
      const sooner = await prisma.reminder.create({
        data: {
          title: 'Sooner',
          dueAt: addDays(new Date(), 1),
          assigneeIds: [],
        },
      });

      const result = await reminders.list();

      expect(result.map((r) => r.id)).toEqual([sooner.id, later.id]);
    });

    it('filters to reminders due within [from, to] inclusive when both are given', async () => {
      const before = await prisma.reminder.create({
        data: {
          title: 'Before range',
          dueAt: new Date('2026-08-09T12:00:00Z'),
          assigneeIds: [],
        },
      });
      const atStart = await prisma.reminder.create({
        data: {
          title: 'At range start',
          dueAt: new Date('2026-08-10T00:00:00Z'),
          assigneeIds: [],
        },
      });
      const atEnd = await prisma.reminder.create({
        data: {
          title: 'At range end',
          dueAt: new Date('2026-08-16T23:59:00Z'),
          assigneeIds: [],
        },
      });
      const after = await prisma.reminder.create({
        data: {
          title: 'After range',
          dueAt: new Date('2026-08-17T00:00:00Z'),
          assigneeIds: [],
        },
      });

      const result = await reminders.list('2026-08-10', '2026-08-16');

      expect(result.map((r) => r.id).sort()).toEqual(
        [atStart.id, atEnd.id].sort(),
      );
      expect(result.find((r) => r.id === before.id)).toBeUndefined();
      expect(result.find((r) => r.id === after.id)).toBeUndefined();
    });

    it('rejects a from without a to, and vice versa', async () => {
      await expect(reminders.list('2026-08-10', undefined)).rejects.toThrow(
        ApiError,
      );
      await expect(reminders.list(undefined, '2026-08-16')).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe('dueToday', () => {
    it('excludes done reminders and reminders due after today', async () => {
      const dueToday = await prisma.reminder.create({
        data: { title: 'Due today', dueAt: new Date(), assigneeIds: [] },
      });
      await prisma.reminder.create({
        data: {
          title: 'Done already',
          dueAt: new Date(),
          doneAt: new Date(),
          assigneeIds: [],
        },
      });
      await prisma.reminder.create({
        data: {
          title: 'Due tomorrow',
          dueAt: addDays(new Date(), 1),
          assigneeIds: [],
        },
      });
      await prisma.reminder.create({
        data: {
          title: 'Overdue',
          dueAt: subDays(new Date(), 1),
          assigneeIds: [],
        },
      });

      const result = await reminders.dueToday();

      expect(result.map((r) => r.title).sort()).toEqual([
        'Due today',
        'Overdue',
      ]);
      expect(result.find((r) => r.id === dueToday.id)).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a reminder with no assignees', async () => {
      const created = await reminders.create({
        title: 'Water plants',
        dueAt: new Date().toISOString(),
        assigneeIds: [],
      });

      expect(created.title).toBe('Water plants');
      expect(created.assigneeIds).toEqual([]);
      expect(created.doneAt).toBeNull();
    });

    it('creates a reminder assigned to a real user', async () => {
      const user = await seedUser();

      const created = await reminders.create({
        title: 'Pay rent',
        dueAt: new Date().toISOString(),
        assigneeIds: [user.id],
      });

      expect(created.assigneeIds).toEqual([user.id]);
    });

    it('rejects an assigneeId that does not belong to any user', async () => {
      await expect(
        reminders.create({
          title: 'Pay rent',
          dueAt: new Date().toISOString(),
          assigneeIds: ['00000000-0000-0000-0000-000000000000'],
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('toggle', () => {
    it('sets doneAt when toggling an undone reminder', async () => {
      const reminder = await prisma.reminder.create({
        data: { title: 'Water plants', dueAt: new Date(), assigneeIds: [] },
      });

      const toggled = await reminders.toggle(reminder.id);

      expect(toggled.doneAt).not.toBeNull();
    });

    it('clears doneAt back to null when toggling a done reminder — undo, not delete', async () => {
      const reminder = await prisma.reminder.create({
        data: {
          title: 'Water plants',
          dueAt: new Date(),
          doneAt: new Date(),
          assigneeIds: [],
        },
      });

      const toggled = await reminders.toggle(reminder.id);

      expect(toggled.doneAt).toBeNull();
    });

    it('rejects an unknown reminder id', async () => {
      await expect(
        reminders.toggle('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(ApiError);
    });
  });
});
