import * as argon2 from 'argon2';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdsService } from './households.service';

describe('HouseholdsService', () => {
  let prisma: PrismaService;
  let households: HouseholdsService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users RESTART IDENTITY CASCADE`;
    households = new HouseholdsService(prisma);
  });

  async function seedUser(householdId: string, email: string) {
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    return prisma.user.create({
      data: {
        householdId,
        email,
        passwordHash,
        name: email.split('@')[0],
        avatarKey: email.split('@')[0],
        emailVerifiedAt: new Date(),
      },
    });
  }

  it('rejects an unknown user id', async () => {
    await expect(
      households.getForUser('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(ApiError);
  });

  it('returns every member of the caller’s household plus member_order, never passwordHash', async () => {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const mia = await seedUser(household.id, 'mia@example.com');
    const sam = await seedUser(household.id, 'sam@example.com');
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [sam.id, mia.id] },
    });

    const result = await households.getForUser(mia.id);

    expect(result.memberOrder).toEqual([sam.id, mia.id]);
    expect(result.users.map((u) => u.id).sort()).toEqual(
      [mia.id, sam.id].sort(),
    );
    expect(result.users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('never returns another household’s users', async () => {
    const householdA = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const householdB = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const userA = await seedUser(householdA.id, 'a@example.com');
    await seedUser(householdB.id, 'b@example.com');

    const result = await households.getForUser(userA.id);

    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe(userA.id);
  });

  describe('updateMemberOrder', () => {
    it('rejects an unknown caller', async () => {
      await expect(
        households.updateMemberOrder('00000000-0000-0000-0000-000000000000', {
          memberOrder: [],
        }),
      ).rejects.toThrow(ApiError);
    });

    it('accepts a reordering that is a permutation of the current members', async () => {
      const household = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const mia = await seedUser(household.id, 'mia@example.com');
      const sam = await seedUser(household.id, 'sam@example.com');
      await prisma.household.update({
        where: { id: household.id },
        data: { memberOrder: [mia.id, sam.id] },
      });

      const result = await households.updateMemberOrder(mia.id, {
        memberOrder: [sam.id, mia.id],
      });

      expect(result.memberOrder).toEqual([sam.id, mia.id]);
    });

    it('rejects a reordering missing a current member', async () => {
      const household = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const mia = await seedUser(household.id, 'mia@example.com');
      await seedUser(household.id, 'sam@example.com');

      await expect(
        households.updateMemberOrder(mia.id, { memberOrder: [mia.id] }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects a reordering with an id from another household', async () => {
      const household = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const otherHousehold = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const mia = await seedUser(household.id, 'mia@example.com');
      const sam = await seedUser(household.id, 'sam@example.com');
      const outsider = await seedUser(
        otherHousehold.id,
        'outsider@example.com',
      );

      await expect(
        households.updateMemberOrder(mia.id, {
          memberOrder: [sam.id, outsider.id],
        }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects a duplicate id', async () => {
      const household = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const mia = await seedUser(household.id, 'mia@example.com');
      // A second member so mia.id repeated twice is the same length as
      // the real member set — the length check alone wouldn't catch this,
      // only the dedup check would.
      await seedUser(household.id, 'sam@example.com');

      await expect(
        households.updateMemberOrder(mia.id, {
          memberOrder: [mia.id, mia.id],
        }),
      ).rejects.toThrow(ApiError);
    });
  });
});
