// `alexa-verifier` is ESM-only ("type": "module" in its own package.json),
// so it's loaded via a dynamic import() rather than a top-level `import`,
// which this CommonJS-compiled codebase can't `require()` directly. Kept in
// its own file specifically so AlexaSignatureGuard's unit test can
// `jest.mock` this module instead of mocking a dynamic import. Type
// declared by hand in types/alexa-verifier.d.ts — no @types package exists.

/** Resolves if the signature is valid; rejects with Amazon's error string otherwise. */
export async function verifyAlexaSignature(
  certChainUrl: string,
  signature: string,
  requestBody: string,
): Promise<void> {
  const { default: verify } = await import('alexa-verifier');
  await verify(certChainUrl, signature, requestBody);
}
