import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import type { Household } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { generateToken } from './tokens.util';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('AuthService', () => {
  let prisma: PrismaService;
  let auth: AuthService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, invites, email_verifications, password_resets RESTART IDENTITY CASCADE`;
    auth = new AuthService(
      prisma,
      new JwtService({
        secret: 'test-secret',
        signOptions: { expiresIn: '30d' },
      }),
      new MailService(),
    );
  });

  async function seedHousehold(): Promise<Household> {
    return prisma.household.create({ data: { memberOrder: [] } });
  }

  async function seedVerifiedUser(
    householdId: string,
    email: string,
    password: string,
  ) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return prisma.user.create({
      data: {
        householdId,
        email,
        passwordHash,
        name: 'Test User',
        avatarKey: 'test-user',
        emailVerifiedAt: new Date(),
      },
    });
  }

  async function seedInvite(
    householdId: string,
    invitedByUserId: string,
    email: string,
    opts?: { expired?: boolean; accepted?: boolean },
  ) {
    return prisma.invite.create({
      data: {
        householdId,
        invitedByUserId,
        email,
        token: generateToken(),
        expiresAt: new Date(
          Date.now() + (opts?.expired ? -1000 : SEVEN_DAYS_MS),
        ),
        acceptedAt: opts?.accepted ? new Date() : null,
      },
    });
  }

  describe('login', () => {
    it('returns an access token and a passwordHash-free user for correct credentials', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'correct-horse',
      );

      const result = await auth.login('mia@example.com', 'correct-horse');

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.user.id).toBe(user.id);
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('normalizes email casing/whitespace before lookup', async () => {
      const household = await seedHousehold();
      await seedVerifiedUser(household.id, 'mia@example.com', 'correct-horse');

      const result = await auth.login('  Mia@Example.com  ', 'correct-horse');

      expect(result.user.email).toBe('mia@example.com');
    });

    it('rejects a wrong password with invalid_credentials', async () => {
      const household = await seedHousehold();
      await seedVerifiedUser(household.id, 'mia@example.com', 'correct-horse');

      try {
        await auth.login('mia@example.com', 'wrong');
        throw new Error('expected login to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).getStatus()).toBe(401);
        expect((error as ApiError).getResponse()).toEqual({
          field: 'form',
          code: 'invalid_credentials',
        });
      }
    });

    it('rejects an unknown email with the exact same generic error as a wrong password', async () => {
      try {
        await auth.login('nobody@example.com', 'whatever');
        throw new Error('expected login to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).getStatus()).toBe(401);
        expect((error as ApiError).getResponse()).toEqual({
          field: 'form',
          code: 'invalid_credentials',
        });
      }
    });

    it('floors response time at ~300ms even for an unknown email (timing-attack mitigation)', async () => {
      const started = Date.now();
      await auth.login('nobody@example.com', 'whatever').catch(() => undefined);
      expect(Date.now() - started).toBeGreaterThanOrEqual(295);
    });

    it('rejects an unverified account with email_not_verified, checked after password verification', async () => {
      const household = await seedHousehold();
      const passwordHash = await argon2.hash('correct-horse', {
        type: argon2.argon2id,
      });
      await prisma.user.create({
        data: {
          householdId: household.id,
          email: 'unverified@example.com',
          passwordHash,
          name: 'Unverified',
          avatarKey: 'unverified',
          emailVerifiedAt: null,
        },
      });

      try {
        await auth.login('unverified@example.com', 'correct-horse');
        throw new Error('expected login to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).getResponse()).toEqual({
          field: 'form',
          code: 'email_not_verified',
        });
      }

      // Wrong password on the same unverified account still reports
      // invalid_credentials, not email_not_verified — verified first.
      try {
        await auth.login('unverified@example.com', 'wrong');
        throw new Error('expected login to reject');
      } catch (error) {
        expect((error as ApiError).getResponse()).toEqual({
          field: 'form',
          code: 'invalid_credentials',
        });
      }
    });
  });

  describe('register', () => {
    it('creates a verified-pending user, appends to member_order, marks the invite accepted, and issues a verification token', async () => {
      const household = await seedHousehold();
      const inviter = await seedVerifiedUser(
        household.id,
        'inviter@example.com',
        'whatever123',
      );
      await prisma.household.update({
        where: { id: household.id },
        data: { memberOrder: [inviter.id] },
      });
      const invite = await seedInvite(
        household.id,
        inviter.id,
        'newperson@example.com',
      );

      const result = await auth.register({
        token: invite.token,
        name: 'New Person',
        password: 'brand-new-pass',
        confirmPassword: 'brand-new-pass',
      });

      expect(result).toEqual({ ok: true, email: 'newperson@example.com' });

      const created = await prisma.user.findUniqueOrThrow({
        where: { email: 'newperson@example.com' },
      });
      expect(created.emailVerifiedAt).toBeNull();
      expect(created.avatarKey).toBe('new-person');

      const updatedHousehold = await prisma.household.findUniqueOrThrow({
        where: { id: household.id },
      });
      expect(updatedHousehold.memberOrder).toEqual([inviter.id, created.id]);

      const acceptedInvite = await prisma.invite.findUniqueOrThrow({
        where: { id: invite.id },
      });
      expect(acceptedInvite.acceptedAt).not.toBeNull();

      const verification = await prisma.emailVerification.findFirstOrThrow({
        where: { userId: created.id },
      });
      expect(verification.consumedAt).toBeNull();
    });

    it('rejects a missing invite token with invite_invalid', async () => {
      try {
        await auth.register({
          token: 'does-not-exist',
          name: 'X',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        });
        throw new Error('expected register to reject');
      } catch (error) {
        expect((error as ApiError).getResponse()).toEqual({
          field: 'token',
          code: 'invite_invalid',
        });
      }
    });

    it('rejects an expired invite token with invite_invalid', async () => {
      const household = await seedHousehold();
      const inviter = await seedVerifiedUser(
        household.id,
        'inviter@example.com',
        'whatever123',
      );
      const invite = await seedInvite(
        household.id,
        inviter.id,
        'expired@example.com',
        { expired: true },
      );

      await expect(
        auth.register({
          token: invite.token,
          name: 'X',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects an already-accepted invite token with invite_invalid', async () => {
      const household = await seedHousehold();
      const inviter = await seedVerifiedUser(
        household.id,
        'inviter@example.com',
        'whatever123',
      );
      const invite = await seedInvite(
        household.id,
        inviter.id,
        'accepted@example.com',
        {
          accepted: true,
        },
      );

      await expect(
        auth.register({
          token: invite.token,
          name: 'X',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects when a user with the invite email already exists', async () => {
      const household = await seedHousehold();
      const inviter = await seedVerifiedUser(
        household.id,
        'inviter@example.com',
        'whatever123',
      );
      await seedVerifiedUser(household.id, 'taken@example.com', 'whatever123');
      const invite = await seedInvite(
        household.id,
        inviter.id,
        'taken@example.com',
      );

      try {
        await auth.register({
          token: invite.token,
          name: 'X',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        });
        throw new Error('expected register to reject');
      } catch (error) {
        expect((error as ApiError).getResponse()).toEqual({
          field: 'form',
          code: 'email_taken',
        });
      }
    });

    it('appends both new members to member_order without dropping one under concurrent registrations', async () => {
      const household = await seedHousehold();
      const inviter = await seedVerifiedUser(
        household.id,
        'inviter@example.com',
        'whatever123',
      );
      const inviteA = await seedInvite(
        household.id,
        inviter.id,
        'personA@example.com',
      );
      const inviteB = await seedInvite(
        household.id,
        inviter.id,
        'personB@example.com',
      );

      await Promise.all([
        auth.register({
          token: inviteA.token,
          name: 'Person A',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        }),
        auth.register({
          token: inviteB.token,
          name: 'Person B',
          password: 'brand-new-pass',
          confirmPassword: 'brand-new-pass',
        }),
      ]);

      const [userA, userB, updatedHousehold] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { email: 'personA@example.com' },
        }),
        prisma.user.findUniqueOrThrow({
          where: { email: 'personB@example.com' },
        }),
        prisma.household.findUniqueOrThrow({ where: { id: household.id } }),
      ]);

      expect(updatedHousehold.memberOrder).toHaveLength(2);
      expect(updatedHousehold.memberOrder).toEqual(
        expect.arrayContaining([userA.id, userB.id]),
      );
    });
  });

  describe('activate', () => {
    it('marks the verification consumed and the user emailVerifiedAt set', async () => {
      const household = await seedHousehold();
      const passwordHash = await argon2.hash('whatever123', {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          householdId: household.id,
          email: 'pending@example.com',
          passwordHash,
          name: 'Pending',
          avatarKey: 'pending',
          emailVerifiedAt: null,
        },
      });
      const token = generateToken();
      await prisma.emailVerification.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const result = await auth.activate(token);

      expect(result).toEqual({ ok: true });
      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updatedUser.emailVerifiedAt).not.toBeNull();
      const verification = await prisma.emailVerification.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(verification.consumedAt).not.toBeNull();
    });

    it('rejects a missing token with verification_invalid', async () => {
      await expect(auth.activate('does-not-exist')).rejects.toThrow(ApiError);
    });

    it('rejects an expired token with verification_invalid', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'x@example.com',
        'whatever123',
      );
      const token = generateToken();
      await prisma.emailVerification.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      await expect(auth.activate(token)).rejects.toThrow(ApiError);
    });

    it('rejects an already-consumed token with verification_invalid', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'x@example.com',
        'whatever123',
      );
      const token = generateToken();
      await prisma.emailVerification.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 1000),
          consumedAt: new Date(),
        },
      });

      await expect(auth.activate(token)).rejects.toThrow(ApiError);
    });
  });

  describe('forgotPassword', () => {
    it('creates a token and sends mail for an existing account', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'correct-horse',
      );

      const result = await auth.forgotPassword('mia@example.com');

      expect(result).toEqual({ ok: true });
      const reset = await prisma.passwordReset.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(reset.consumedAt).toBeNull();
      expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('normalizes email casing/whitespace before lookup', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'correct-horse',
      );

      await auth.forgotPassword('  Mia@Example.com  ');

      const reset = await prisma.passwordReset.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(reset).not.toBeNull();
    });

    it('returns the exact same response for an unknown email, without creating a token', async () => {
      const result = await auth.forgotPassword('nobody@example.com');

      expect(result).toEqual({ ok: true });
      expect(await prisma.passwordReset.count()).toBe(0);
    });
  });

  describe('resetPassword', () => {
    async function seedReset(
      userId: string,
      opts?: { expired?: boolean; consumed?: boolean },
    ) {
      const token = generateToken();
      await prisma.passwordReset.create({
        data: {
          userId,
          token,
          expiresAt: new Date(
            Date.now() + (opts?.expired ? -1000 : 60 * 60 * 1000),
          ),
          consumedAt: opts?.consumed ? new Date() : null,
        },
      });
      return token;
    }

    it('hashes the new password, consumes the token, and allows login with it', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'old-password',
      );
      const token = await seedReset(user.id);

      const result = await auth.resetPassword(token, 'brand-new-password');

      expect(result).toEqual({ ok: true });
      const reset = await prisma.passwordReset.findUniqueOrThrow({
        where: { token },
      });
      expect(reset.consumedAt).not.toBeNull();

      // Old password no longer works, new one does.
      await expect(
        auth.login('mia@example.com', 'old-password'),
      ).rejects.toThrow(ApiError);
      const loginResult = await auth.login(
        'mia@example.com',
        'brand-new-password',
      );
      expect(loginResult.user.id).toBe(user.id);
    });

    it('also verifies an unverified account', async () => {
      const household = await seedHousehold();
      const passwordHash = await argon2.hash('old-password', {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          householdId: household.id,
          email: 'unverified@example.com',
          passwordHash,
          name: 'Unverified',
          avatarKey: 'unverified',
          emailVerifiedAt: null,
        },
      });
      const token = await seedReset(user.id);

      await auth.resetPassword(token, 'brand-new-password');

      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updatedUser.emailVerifiedAt).not.toBeNull();
    });

    it('does not overwrite an existing emailVerifiedAt timestamp', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'old-password',
      );
      const originalVerifiedAt = user.emailVerifiedAt;
      const token = await seedReset(user.id);

      await auth.resetPassword(token, 'brand-new-password');

      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updatedUser.emailVerifiedAt).toEqual(originalVerifiedAt);
    });

    it('rejects a missing token with reset_invalid', async () => {
      await expect(
        auth.resetPassword('does-not-exist', 'brand-new-password'),
      ).rejects.toThrow(ApiError);
    });

    it('rejects an expired token with reset_invalid', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'old-password',
      );
      const token = await seedReset(user.id, { expired: true });

      try {
        await auth.resetPassword(token, 'brand-new-password');
        throw new Error('expected resetPassword to reject');
      } catch (error) {
        expect((error as ApiError).getResponse()).toEqual({
          field: 'token',
          code: 'reset_invalid',
        });
      }
    });

    it('rejects an already-consumed token with reset_invalid', async () => {
      const household = await seedHousehold();
      const user = await seedVerifiedUser(
        household.id,
        'mia@example.com',
        'old-password',
      );
      const token = await seedReset(user.id, { consumed: true });

      await expect(
        auth.resetPassword(token, 'brand-new-password'),
      ).rejects.toThrow(ApiError);
    });
  });
});
