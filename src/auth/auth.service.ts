import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { ApiError } from '../common/api-error';
import { MailService } from '../mail/mail.service';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './normalize-email.util';
import { RegisterDto } from './dto/register.dto';
import { slugifyAvatarKey } from './slugify-avatar-key.util';
import { generateToken } from './tokens.util';

// A real argon2id hash of a password nobody uses. Verifying against this
// when the email isn't found keeps the "no such account" path doing the
// same work (and taking about the same time) as the "wrong password"
// path, instead of returning early and leaking account existence via
// timing.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ioSxuYJZObNpknjkAXiaHA$fuvU0zVW56c/NCnBLgVmn9fWMYuuXF0OEDROsvjkJV4';

const MIN_LOGIN_MS = 300;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
// Short-lived on purpose, unlike the 7-day invite or 24h verification
// window — a reset link is used right away or not at all, and a shorter
// window shrinks how long a compromised inbox stays exploitable.
const RESET_TTL_MS = 60 * 60 * 1000;

export type PublicUser = Omit<User, 'passwordHash'>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toPublicUser(user: User): PublicUser {
  const publicUser: Partial<User> = { ...user };
  delete publicUser.passwordHash;
  return publicUser as PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  /**
   * Verifies email + password. Floors how fast it can return, and gives
   * the same generic result whether the account doesn't exist or the
   * password is wrong — so both look the same from outside, in shape and
   * in timing.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; user: PublicUser }> {
    const started = Date.now();
    const normalizedEmail = normalizeEmail(email);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);

    await sleep(Math.max(0, MIN_LOGIN_MS - (Date.now() - started)));

    if (!ok || !user) {
      throw new ApiError(401, 'form', 'invalid_credentials');
    }

    // Checked after password verification, not before, so it can't be
    // used to probe whether an email has an account.
    if (user.emailVerifiedAt === null) {
      throw new ApiError(401, 'form', 'email_not_verified');
    }

    const accessToken = this.jwt.sign({ sub: user.id });
    return { accessToken, user: toPublicUser(user) };
  }

  /**
   * Creates the invited user, appends them to household.member_order (the
   * stable anchor rotation/ordering reads from), marks the invite
   * accepted, and issues an email-verification token — one transaction,
   * so a failure partway through never leaves a half-created account. The
   * activation email is sent after commit.
   */
  async register(dto: RegisterDto): Promise<{ ok: true; email: string }> {
    const invite = await this.prisma.invite.findUnique({
      where: { token: dto.token },
    });
    const inviteUsable =
      invite !== null &&
      invite.acceptedAt === null &&
      invite.expiresAt.getTime() > Date.now();
    if (!inviteUsable) {
      throw new ApiError(400, 'token', 'invite_invalid');
    }

    // A previous invite to the same address could already have been
    // completed (or a second invite issued before the first was used) —
    // catch it here rather than hitting the DB's unique constraint.
    const existing = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (existing) {
      throw new ApiError(400, 'form', 'email_taken');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    const avatarKey = slugifyAvatarKey(dto.name);
    const verificationToken = generateToken();

    await this.prisma.$transaction(async (tx) => {
      let user: User;
      try {
        user = await tx.user.create({
          data: {
            householdId: invite.householdId,
            email: invite.email,
            passwordHash,
            name: dto.name,
            avatarKey,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ApiError(400, 'form', 'email_taken');
        }
        throw error;
      }

      // Atomic array append, not a read-then-write — avoids dropping an
      // id under concurrent invite acceptances on the same household.
      await tx.$executeRaw`UPDATE households SET member_order = array_append(member_order, ${user.id}::uuid) WHERE id = ${invite.householdId}::uuid`;

      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      await tx.emailVerification.create({
        data: {
          userId: user.id,
          token: verificationToken,
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        },
      });
    });

    await this.mail.sendActivationEmail(invite.email, verificationToken);

    return { ok: true, email: invite.email };
  }

  async activate(token: string): Promise<{ ok: true }> {
    const verification = await this.prisma.emailVerification.findUnique({
      where: { token },
    });
    const verificationUsable =
      verification !== null &&
      verification.consumedAt === null &&
      verification.expiresAt.getTime() > Date.now();
    if (!verificationUsable) {
      throw new ApiError(400, 'token', 'verification_invalid');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return { ok: true };
  }

  /**
   * Always returns the same response whether or not the account exists —
   * never reveal which emails are registered. Only creates a token and
   * sends mail when a matching user is actually found.
   */
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });

    if (user) {
      const token = generateToken();
      await this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      await this.mail.sendPasswordResetEmail(user.email, token);
    }

    return { ok: true };
  }

  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });
    const resetUsable =
      reset !== null &&
      reset.consumedAt === null &&
      reset.expiresAt.getTime() > Date.now();
    if (!resetUsable) {
      throw new ApiError(400, 'token', 'reset_invalid');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          // Completing a reset — clicking a link sent to the inbox, then
          // setting a new credential — proves control of the address at
          // least as strongly as the original activation link would.
          // There's no resend-activation path today, so refusing this
          // would leave an unverified account with no way back in at
          // all. Never overwrite a real verification timestamp with a
          // later one if it's already set.
          emailVerifiedAt: reset.user.emailVerifiedAt ?? new Date(),
        },
      }),
    ]);

    return { ok: true };
  }
}
