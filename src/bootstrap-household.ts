import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { BootstrapModule } from './bootstrap/bootstrap.module';
import { HouseholdBootstrapService } from './bootstrap/household-bootstrap.service';

// One-off command for a fresh production database: registration is
// invite-only and invites require a signed-in user, so an empty database
// otherwise has no path to a first account. Run once, after migrations,
// before anyone can log in — see my-home-backend/CLAUDE.md's Commands
// section and the top-level repo's Production (VPS) deploy notes.
async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node dist/bootstrap-household.js <email>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(BootstrapModule, {
    logger: ['warn', 'error'],
  });
  try {
    const { link } = await app.get(HouseholdBootstrapService).bootstrap(email);
    // Printed in addition to the email MailService already sent (or logged,
    // if SMTP isn't configured) — the operator's way in if that mail is
    // lost or lands in spam.
    console.log(`Invite link for ${email}:\n${link}`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
