import { Injectable } from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken } from './tokens.util';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(invitedByUserId: string, email: string): Promise<{ ok: true }> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedByUserId },
    });
    if (!inviter) {
      // The token decoded fine, but the user it names is gone.
      throw new ApiError(401, 'form', 'invalid_session');
    }

    const invite = await this.createInvite(
      inviter.householdId,
      invitedByUserId,
      email,
    );
    await this.mail.sendInviteEmail(invite.email, invite.token);

    return { ok: true };
  }

  /**
   * Only for the household-bootstrap command: the one invite that has no
   * signed-in inviter, because it's the very first one, issued against an
   * empty database. `invitedByUserId` is nullable in the schema for
   * exactly this case — see the Invite model.
   */
  async createBootstrap(
    householdId: string,
    email: string,
  ): Promise<{ token: string }> {
    const invite = await this.createInvite(householdId, null, email);
    await this.mail.sendInviteEmail(invite.email, invite.token);
    return { token: invite.token };
  }

  private createInvite(
    householdId: string,
    invitedByUserId: string | null,
    email: string,
  ) {
    return this.prisma.invite.create({
      data: {
        householdId,
        invitedByUserId,
        email: email.trim(),
        token: generateToken(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  }

  /**
   * For the public register page: which email address is this invite for,
   * and is the link still usable? Same usability rule as AuthService.register()
   * (not yet accepted, not expired) — read-only here, doesn't consume it.
   */
  async findUsableByToken(token: string): Promise<{ email: string } | null> {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    const usable =
      invite !== null &&
      invite.acceptedAt === null &&
      invite.expiresAt.getTime() > Date.now();
    return usable ? { email: invite.email } : null;
  }
}
