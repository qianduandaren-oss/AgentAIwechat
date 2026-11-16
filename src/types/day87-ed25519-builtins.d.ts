/** Minimal Ed25519 additions to existing node:crypto shims. */
declare module "node:crypto" {
  export function randomBytes(size: number): Uint8Array;
  export function verify(
    algorithm: null, data: Uint8Array, key: string, signature: Uint8Array
  ): boolean;
  export function sign(
    algorithm: null, data: Uint8Array, key: string
  ): Uint8Array;
  export function generateKeyPairSync(
    type: "ed25519",
    options: {
      publicKeyEncoding: { type: "spki"; format: "pem" };
      privateKeyEncoding: { type: "pkcs8"; format: "pem" };
    }
  ): { publicKey: string; privateKey: string };
}
