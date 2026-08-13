import * as argon2 from 'argon2';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from './invites.service';
import { generateToken } from './tokens.util';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('InvitesService', () => {
  let prisma: PrismaService;
  let invites: InvitesService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, invites RESTART IDENTITY CASCADE`;
    invites = new InvitesService(prisma, new MailService());
  });

  async function seedInviter() {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    return prisma.user.create({
      data: {
        householdId: household.id,
        email: 'inviter@example.com',
        passwordHash,
        name: 'Inviter',
        role: 'Parent',
        avatarKey: 'inviter',
        emailVerifiedAt: new Date(),
      },
    });
  }

  describe('findUsableByToken', () => {
    it('returns the invite email for a pending, unexpired token', async () => {
      const inviter = await seedInviter();
      const invite = await prisma.invite.create({
        data: {
          householdId: inviter.householdId,
          invitedByUserId: inviter.id,
          email: 'newperson@example.com',
          token: generateToken(),
          expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
        },
      });

      expect(await invites.findUsableByToken(invite.token)).toEqual({
        email: 'newperson@example.com',
      });
    });

    it('returns null for an unknown token', async () => {
      expect(await invites.findUsableByToken('nonexistent')).toBeNull();
    });

    it('returns null for an expired token', async () => {
      const inviter = await seedInviter();
      const invite = await prisma.invite.create({
        data: {
          householdId: inviter.householdId,
          invitedByUserId: inviter.id,
          email: 'newperson@example.com',
          token: generateToken(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      expect(await invites.findUsableByToken(invite.token)).toBeNull();
    });

    it('returns null for an already-accepted token', async () => {
      const inviter = await seedInviter();
      const invite = await prisma.invite.create({
        data: {
          householdId: inviter.householdId,
          invitedByUserId: inviter.id,
          email: 'newperson@example.com',
          token: generateToken(),
          expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
          acceptedAt: new Date(),
        },
      });

      expect(await invites.findUsableByToken(invite.token)).toBeNull();
    });
  });
});
