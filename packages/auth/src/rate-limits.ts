import { createHmac } from "node:crypto";

export const AUTH_RATE_LIMITS = {
  signUpFingerprint: { limit: 5, windowSeconds: 3600 },
  signUpEmail: { limit: 3, windowSeconds: 3600 },
  signInFingerprint: { limit: 20, windowSeconds: 900 },
  signInEmail: { limit: 10, windowSeconds: 900 },
  verificationFingerprint: { limit: 10, windowSeconds: 900 },
  verificationEmail: { limit: 3, windowSeconds: 3600 },
  forgotFingerprint: { limit: 5, windowSeconds: 3600 },
  forgotEmail: { limit: 5, windowSeconds: 3600 },
  resetFingerprint: { limit: 10, windowSeconds: 900 },
} as const;

export function rateLimitKey(secret: Uint8Array, value: string): string {
  if (secret.byteLength !== 32) {
    throw new Error("Rate-limit HMAC secret must contain 32 bytes");
  }
  return createHmac("sha256", Buffer.from(secret))
    .update("lovechapter-rate-limit-v1\0")
    .update(value)
    .digest("hex");
}
