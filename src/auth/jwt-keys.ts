// PEM keys travel through .env files, Docker Compose, and VPS shell/systemd
// environments as a single line — real newlines don't survive all of those
// reliably, so they're stored with literal \n escapes and unescaped here.
function normalizePem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return normalizePem(value);
}

/** Signs tokens. Never committed, never leaves this service. */
export function getJwtPrivateKey(): string {
  return requireEnv('JWT_PRIVATE_KEY');
}

/** Verifies tokens. Not a secret — safe to hand to any client that needs to verify locally. */
export function getJwtPublicKey(): string {
  return requireEnv('JWT_PUBLIC_KEY');
}
