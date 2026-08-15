import { InvitesService } from '../auth/invites.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdBootstrapService } from './household-bootstrap.service';

describe('HouseholdBootstrapService', () => {
  let prisma: PrismaService;
  let bootstrap: HouseholdBootstrapService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE households, users, invites RESTART IDENTITY CASCADE`;
    const mail = new MailService();
    bootstrap = new HouseholdBootstrapService(
      prisma,
      new InvitesService(prisma, mail),
      mail,
    );
  });

  it('creates the household and an invite with no inviter', async () => {
    const { link } = await bootstrap.bootstrap('first@example.com');

    const household = await prisma.household.findFirstOrThrow();
    const invite = await prisma.invite.findFirstOrThrow({
      where: { householdId: household.id },
    });

    expect(invite.email).toBe('first@example.com');
    expect(invite.invitedByUserId).toBeNull();
    expect(invite.acceptedAt).toBeNull();
    expect(link).toContain(`/register?token=${invite.token}`);
  });

  it('refuses to run if a household already exists', async () => {
    await prisma.household.create({ data: {} });

    await expect(bootstrap.bootstrap('second@example.com')).rejects.toThrow(
      /already exists/,
    );
  });
});
