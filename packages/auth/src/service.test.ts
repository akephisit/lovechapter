import type { PasswordHasher } from "./ports";
import { createActionTokenCodec } from "./tokens";
import { AuthService } from "./service";
import { InMemoryAuthRepository } from "./testing/in-memory-auth-repository";
import { describe, expect, it } from "vitest";

const signUpInput = {
  displayName: "คู่รัก",
  email: "Couple@example.test",
  password: "correct-password-123",
};

describe("AuthService", () => {
  it("keeps duplicate sign-up responses generic with one current job", async () => {
    const harness = createHarness();

    await expect(
      harness.auth.signUp(signUpInput, "203.0.113.7"),
    ).resolves.toEqual({ accepted: true });
    await expect(
      harness.auth.signUp(signUpInput, "203.0.113.7"),
    ).resolves.toEqual({ accepted: true });

    expect(harness.repository.accountsByEmailKey.size).toBe(1);
    expect(harness.repository.currentJobs("verification")).toHaveLength(1);
  });

  it("uses the same invalid-credentials result for unverified and missing accounts", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");

    await expect(
      harness.auth.signIn(
        { email: signUpInput.email, password: signUpInput.password },
        "203.0.113.7",
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      harness.auth.signIn(
        { email: "missing@example.test", password: signUpInput.password },
        "203.0.113.8",
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(harness.passwordHasher.syntheticVerifications).toBe(1);
  });

  it("allows exactly one concurrent verification-token consumer", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");
    const token = harness.token("verify_email");

    const outcomes = await Promise.allSettled([
      harness.auth.verifyEmail({ token }, "203.0.113.7"),
      harness.auth.verifyEmail({ token }, "203.0.113.8"),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
  });

  it("resets the password, revokes old sessions, and does not auto-login", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");
    await harness.auth.verifyEmail(
      { token: harness.token("verify_email") },
      "203.0.113.7",
    );
    const session = await harness.auth.signIn(
      { email: signUpInput.email, password: signUpInput.password },
      "203.0.113.7",
    );
    await expect(
      harness.auth.resolveSession(session.token),
    ).resolves.toMatchObject({
      provider: "local",
      subject: expect.any(String),
    });
    await expect(
      harness.auth.forgotPassword({ email: signUpInput.email }, "203.0.113.7"),
    ).resolves.toEqual({ accepted: true });

    await expect(
      harness.auth.resetPassword(
        {
          token: harness.token("reset_password"),
          password: "replacement-password-456",
        },
        "203.0.113.7",
      ),
    ).resolves.toEqual({ reset: true });

    await expect(
      harness.auth.resolveSession(session.token),
    ).resolves.toBeNull();
    await expect(
      harness.auth.signIn(
        { email: signUpInput.email, password: signUpInput.password },
        "203.0.113.8",
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      harness.auth.signIn(
        {
          email: signUpInput.email,
          password: "replacement-password-456",
        },
        "203.0.113.8",
      ),
    ).resolves.toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it("rehashes an old valid password envelope before creating the session", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");
    await harness.auth.verifyEmail(
      { token: harness.token("verify_email") },
      "203.0.113.7",
    );
    const account = harness.repository.accountsByEmailKey.get(
      "couple@example.test",
    );
    if (!account) throw new Error("Test account missing");
    account.passwordHash = `test$v=1$${signUpInput.password}`;

    await harness.auth.signIn(
      { email: signUpInput.email, password: signUpInput.password },
      "203.0.113.7",
    );

    expect(account.passwordHash).toBe(`test$v=2$${signUpInput.password}`);
  });

  it("returns generic forgot-password responses without queuing missing accounts", async () => {
    const harness = createHarness();

    await expect(
      harness.auth.forgotPassword(
        { email: "missing@example.test" },
        "203.0.113.7",
      ),
    ).resolves.toEqual({ accepted: true });
    expect(harness.repository.currentJobs("reset")).toHaveLength(0);
  });

  it("rate limits before the next synthetic password verification", async () => {
    const harness = createHarness();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        harness.auth.signIn(
          { email: "missing@example.test", password: signUpInput.password },
          "203.0.113.7",
        ),
      ).rejects.toMatchObject({ code: "invalid_credentials" });
    }

    await expect(
      harness.auth.signIn(
        { email: "missing@example.test", password: signUpInput.password },
        "203.0.113.7",
      ),
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(harness.passwordHasher.syntheticVerifications).toBe(10);
  });

  it("rejects an expired action token", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");
    const token = harness.token("verify_email");
    harness.clock.advance(30 * 60 * 1000 + 1);

    await expect(
      harness.auth.verifyEmail({ token }, "203.0.113.7"),
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects a stale sign-in paused across a password reset", async () => {
    const harness = createHarness();
    await harness.auth.signUp(signUpInput, "203.0.113.7");
    await harness.auth.verifyEmail(
      { token: harness.token("verify_email") },
      "203.0.113.7",
    );
    await harness.auth.forgotPassword(
      { email: signUpInput.email },
      "203.0.113.7",
    );
    const resetToken = harness.token("reset_password");
    let releaseSession!: () => void;
    let sessionReached!: () => void;
    const reached = new Promise<void>((resolve) => (sessionReached = resolve));
    harness.repository.beforeCreateSession = async () => {
      sessionReached();
      await new Promise<void>((resolve) => (releaseSession = resolve));
    };

    const staleSignIn = harness.auth.signIn(
      { email: signUpInput.email, password: signUpInput.password },
      "203.0.113.8",
    );
    await reached;
    await harness.auth.resetPassword(
      { token: resetToken, password: "replacement-password-456" },
      "203.0.113.7",
    );
    releaseSession();

    await expect(staleSignIn).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });
});

function createHarness() {
  const clock = new MutableClock(new Date("2026-09-22T00:00:00.000Z"));
  const passwordHasher = new TestPasswordHasher();
  const repository = new InMemoryAuthRepository();
  const codec = createActionTokenCodec({
    activeVersion: 1,
    keys: new Map([[1, new Uint8Array(32).fill(7)]]),
  });
  let randomValue = 0;
  const auth = new AuthService({
    repository,
    passwordHasher,
    actionTokenCodec: codec,
    clock,
    rateLimitSecret: new Uint8Array(32).fill(9),
    randomBytes: (size) => new Uint8Array(size).fill((randomValue += 1)),
  });
  return {
    auth,
    clock,
    passwordHasher,
    repository,
    token(purpose: "verify_email" | "reset_password") {
      const metadata = repository.currentToken(purpose);
      if (!metadata) throw new Error(`Missing ${purpose} token`);
      return codec.create(metadata);
    },
  };
}

class MutableClock {
  constructor(private value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

class TestPasswordHasher implements PasswordHasher {
  syntheticVerifications = 0;

  async hash(password: string): Promise<string> {
    return `test$v=2$${password}`;
  }

  async verify(password: string, envelope: string) {
    const match = /^test\$v=(1|2)\$(.*)$/s.exec(envelope);
    return {
      valid: match?.[2] === password,
      needsRehash: match?.[1] === "1",
    };
  }

  async verifySynthetic(_password: string): Promise<void> {
    this.syntheticVerifications += 1;
  }
}
