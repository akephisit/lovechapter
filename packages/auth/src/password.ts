import {
  randomBytes as nodeRandomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

import type { PasswordHasher } from "./ports";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 5;
const SCRYPT_DERIVED_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAX_MEMORY_BYTES = 67_108_864;

export const SYNTHETIC_PASSWORD_ENVELOPE =
  "scrypt$v=1$N=16384$r=8$p=5$dk=32$AAECAwQFBgcICQoLDA0ODw$7EO4bEoJd2uQF11XUEdiaHv7alI0QCtIY4z7w27klb8";

export type ScryptParameters = {
  N: number;
  r: number;
  p: number;
  maxmem: number;
  derivedKeyLength: number;
};

export type ScryptDerivation = (
  password: string,
  salt: Uint8Array,
  parameters: ScryptParameters,
) => Promise<Uint8Array>;

export type ScryptPasswordHasherOptions = {
  deriveKey?: ScryptDerivation;
  randomBytes?: (size: number) => Uint8Array;
};

export function validatePassword(password: string): string {
  const length = [...password].length;
  if (length < 12 || length > 128) {
    throw new Error("Password must contain 12–128 Unicode code points");
  }
  return password;
}

export function createScryptPasswordHasher(
  options: ScryptPasswordHasherOptions = {},
): PasswordHasher {
  const deriveKey = options.deriveKey ?? deriveScryptKey;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;

  return {
    async hash(password) {
      validatePassword(password);
      const salt = randomBytes(SCRYPT_SALT_BYTES);
      if (salt.byteLength !== SCRYPT_SALT_BYTES) {
        throw new Error("Password salt generator must return 16 bytes");
      }
      const derivedKey = await deriveWithLimit(deriveKey, password, salt);
      return formatEnvelope(salt, derivedKey);
    },
    async verify(password, envelope) {
      const parsed = parseEnvelope(envelope);
      if (!parsed) return { valid: false, needsRehash: true };
      const derivedKey = await deriveWithLimit(
        deriveKey,
        password,
        parsed.salt,
      );
      const valid =
        derivedKey.byteLength === parsed.derivedKey.byteLength &&
        timingSafeEqual(
          Buffer.from(derivedKey),
          Buffer.from(parsed.derivedKey),
        );
      return { valid, needsRehash: false };
    },
    async verifySynthetic(password) {
      await this.verify(password, SYNTHETIC_PASSWORD_ENVELOPE);
    },
  };
}

async function deriveWithLimit(
  deriveKey: ScryptDerivation,
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return scryptSemaphore.run(() =>
    deriveKey(password, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY_BYTES,
      derivedKeyLength: SCRYPT_DERIVED_KEY_BYTES,
    }),
  );
}

function deriveScryptKey(
  password: string,
  salt: Uint8Array,
  parameters: ScryptParameters,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.derivedKeyLength,
      {
        N: parameters.N,
        r: parameters.r,
        p: parameters.p,
        maxmem: parameters.maxmem,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(new Uint8Array(derivedKey));
      },
    );
  });
}

function formatEnvelope(salt: Uint8Array, derivedKey: Uint8Array): string {
  if (derivedKey.byteLength !== SCRYPT_DERIVED_KEY_BYTES) {
    throw new Error("scrypt must return a 32-byte derived key");
  }
  return [
    "scrypt",
    "v=1",
    `N=${SCRYPT_N}`,
    `r=${SCRYPT_R}`,
    `p=${SCRYPT_P}`,
    `dk=${SCRYPT_DERIVED_KEY_BYTES}`,
    Buffer.from(salt).toString("base64url"),
    Buffer.from(derivedKey).toString("base64url"),
  ].join("$");
}

function parseEnvelope(
  envelope: string,
): { salt: Uint8Array; derivedKey: Uint8Array } | null {
  const match =
    /^scrypt\$v=1\$N=16384\$r=8\$p=5\$dk=32\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(
      envelope,
    );
  if (!match?.[1] || !match[2]) return null;
  const salt = Buffer.from(match[1], "base64url");
  const derivedKey = Buffer.from(match[2], "base64url");
  if (
    salt.byteLength !== SCRYPT_SALT_BYTES ||
    derivedKey.byteLength !== SCRYPT_DERIVED_KEY_BYTES
  ) {
    return null;
  }
  return {
    salt: new Uint8Array(salt),
    derivedKey: new Uint8Array(derivedKey),
  };
}

class FifoSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const scryptSemaphore = new FifoSemaphore(2);
