import { randomBytes } from 'node:crypto';

/** Opaque, unguessable token for invite and email-verification links. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}
