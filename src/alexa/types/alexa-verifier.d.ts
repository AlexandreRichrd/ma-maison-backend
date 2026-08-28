// No @types/alexa-verifier package exists — this is the whole surface this
// codebase uses (see alexa-verifier.util.ts). The real package also accepts
// an optional Node-style callback as a 4th argument; unused here, so it's
// left out of this declaration.
declare module 'alexa-verifier' {
  export default function verify(
    certChainUrl: string,
    signature: string,
    requestBody: string,
  ): Promise<void>;
}
