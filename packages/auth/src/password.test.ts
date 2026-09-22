import { describe, expect, it } from "vitest";

import {
  createScryptPasswordHasher,
  SYNTHETIC_PASSWORD_ENVELOPE,
  validatePassword,
  type ScryptDerivation,
} from "./password";

describe("password policy", () => {
  it("counts Unicode code points without trimming or normalization", () => {
    expect(validatePassword("💍".repeat(12))).toBe("💍".repeat(12));
    expect(() => validatePassword("é".repeat(11))).toThrow(
      "12–128 Unicode code points",
    );
    const spaced = "  password-value  ";
    expect(validatePassword(spaced)).toBe(spaced);
  });

  it("hashes byte-for-byte and emits the production envelope", async () => {
    const hasher = createScryptPasswordHasher();
    const envelope = await hasher.hash("é-password-123");

    expect(envelope).toMatch(
      /^scrypt\$v=1\$N=16384\$r=8\$p=5\$dk=32\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    await expect(hasher.verify("é-password-123", envelope)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(
      hasher.verify("e\u0301-password-123", envelope),
    ).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it("uses a committed production-policy envelope for synthetic checks", async () => {
    expect(SYNTHETIC_PASSWORD_ENVELOPE).toMatch(
      /^scrypt\$v=1\$N=16384\$r=8\$p=5\$dk=32\$/,
    );
    await expect(
      createScryptPasswordHasher().verifySynthetic("unknown-password"),
    ).resolves.toBeUndefined();
  });

  it("caps scrypt at two FIFO derivations across hasher instances", async () => {
    const started: number[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const deriveKey: ScryptDerivation = async () => {
      const position = started.length + 1;
      started.push(position);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return new Uint8Array(32);
    };
    const options = {
      deriveKey,
      randomBytes: () => new Uint8Array(16),
    };
    const firstHasher = createScryptPasswordHasher(options);
    const secondHasher = createScryptPasswordHasher(options);

    const first = firstHasher.hash("password-number-one");
    const second = firstHasher.hash("password-number-two");
    const third = secondHasher.hash("password-number-three");
    await viWaitFor(() => started.length === 2);

    expect(maxActive).toBe(2);
    expect(started).toEqual([1, 2]);
    releases.shift()?.();
    await viWaitFor(() => started.length === 3);
    expect(started).toEqual([1, 2, 3]);

    releases.splice(0).forEach((release) => release());
    await Promise.all([first, second, third]);
  });
});

async function viWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for scrypt test state");
}
