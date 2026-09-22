import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { ActionTokenCodec } from "./ports";
import type { ActionTokenClaims, ParsedActionToken } from "./types";

const TOKEN_PREFIX = "lc1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN =
  /^lc1\.([1-9][0-9]*)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([1-9][0-9]*)\.([A-Za-z0-9_-]{43})$/i;

export function hashSessionToken(token: string): string {
  return sha256(token);
}

export function createActionTokenCodec(config: {
  activeVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
}): ActionTokenCodec {
  const keys = new Map<number, Uint8Array>();
  for (const [version, key] of config.keys) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Action-token key versions must be positive integers");
    }
    if (key.byteLength !== 32) {
      throw new Error("Action-token signing keys must contain 32 bytes");
    }
    keys.set(version, key.slice());
  }
  if (!keys.has(config.activeVersion)) {
    throw new Error("The active action-token signing key is missing");
  }

  const parse = (token: string): ParsedActionToken | null => {
    const match = TOKEN_PATTERN.exec(token);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;
    const keyVersion = Number(match[1]);
    const expiryEpochSeconds = Number(match[3]);
    if (
      !Number.isSafeInteger(keyVersion) ||
      !Number.isSafeInteger(expiryEpochSeconds)
    ) {
      return null;
    }
    const mac = Buffer.from(match[4], "base64url");
    if (mac.byteLength !== 32) return null;
    return {
      keyVersion,
      tokenId: match[2],
      expiryEpochSeconds,
      mac: new Uint8Array(mac),
    };
  };

  return {
    create(claims) {
      validateClaims(claims);
      if (claims.signingKeyVersion !== config.activeVersion) {
        throw new Error("Action tokens may only use the active signing key");
      }
      const key = keys.get(config.activeVersion);
      if (!key)
        throw new Error("The active action-token signing key is missing");
      const mac = sign(key, claims);
      return [
        TOKEN_PREFIX,
        config.activeVersion,
        claims.id,
        claims.expiresAtEpochSeconds,
        Buffer.from(mac).toString("base64url"),
      ].join(".");
    },
    parse,
    verify(token, claims) {
      const parsed = parse(token);
      if (
        !parsed ||
        parsed.keyVersion !== claims.signingKeyVersion ||
        parsed.tokenId !== claims.id ||
        parsed.expiryEpochSeconds !== claims.expiresAtEpochSeconds
      ) {
        return false;
      }
      const key = keys.get(parsed.keyVersion);
      if (!key) return false;
      let expected: Uint8Array;
      try {
        validateClaims(claims);
        expected = sign(key, claims);
      } catch {
        return false;
      }
      return timingSafeEqual(Buffer.from(parsed.mac), Buffer.from(expected));
    },
    hash: sha256,
  };
}

function validateClaims(claims: ActionTokenClaims): void {
  if (!UUID_PATTERN.test(claims.id) || !UUID_PATTERN.test(claims.accountId)) {
    throw new Error("Action-token identifiers must be UUIDs");
  }
  if (
    !Number.isSafeInteger(claims.signingKeyVersion) ||
    claims.signingKeyVersion < 1
  ) {
    throw new Error("Action-token key version must be a positive integer");
  }
  if (
    !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
    claims.expiresAtEpochSeconds < 1
  ) {
    throw new Error("Action-token expiry must be a positive integer");
  }
  if (!(["verify_email", "reset_password"] as const).includes(claims.purpose)) {
    throw new Error("Action-token purpose is invalid");
  }
}

function sign(key: Uint8Array, claims: ActionTokenClaims): Uint8Array {
  const canonical = [
    TOKEN_PREFIX,
    claims.signingKeyVersion,
    claims.id,
    claims.accountId,
    claims.purpose,
    claims.expiresAtEpochSeconds,
  ].join("\n");
  return new Uint8Array(
    createHmac("sha256", Buffer.from(key)).update(canonical).digest(),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
