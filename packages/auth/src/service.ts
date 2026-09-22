import type {
  AcceptedResponse,
  ForgotPasswordInput,
  ResendVerificationInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
  VerifyEmailInput,
} from "@lovechapter/contracts";
import { RateLimitExceededError, type Principal } from "@lovechapter/domain";

import { normalizeEmail, type NormalizedEmail } from "./email";
import { invalidCredentials, invalidRequest, invalidToken } from "./errors";
import { validatePassword } from "./password";
import type {
  ActionTokenCodec,
  AuthRepository,
  Clock,
  PasswordHasher,
} from "./ports";
import { AUTH_RATE_LIMITS, rateLimitKey } from "./rate-limits";
import { hashSessionToken } from "./tokens";
import type {
  ActionTokenMetadata,
  AuthRateLimitScope,
  AuthTokenPurpose,
  IssueActionToken,
} from "./types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type CreatedSession = {
  token: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export type AuthServiceDependencies = {
  repository: AuthRepository;
  passwordHasher: PasswordHasher;
  actionTokenCodec: ActionTokenCodec;
  clock: Clock;
  rateLimitSecret: Uint8Array;
  randomBytes?: (size: number) => Uint8Array;
  randomUuid?: () => string;
};

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly passwordHasher: PasswordHasher;
  private readonly actionTokenCodec: ActionTokenCodec;
  private readonly clock: Clock;
  private readonly rateLimitSecret: Uint8Array;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly randomUuid: () => string;

  constructor(dependencies: AuthServiceDependencies) {
    if (dependencies.rateLimitSecret.byteLength !== 32) {
      throw new Error("Rate-limit HMAC secret must contain 32 bytes");
    }
    this.repository = dependencies.repository;
    this.passwordHasher = dependencies.passwordHasher;
    this.actionTokenCodec = dependencies.actionTokenCodec;
    this.clock = dependencies.clock;
    this.rateLimitSecret = dependencies.rateLimitSecret.slice();
    this.randomBytes = dependencies.randomBytes ?? secureRandomBytes;
    this.randomUuid = dependencies.randomUuid ?? (() => crypto.randomUUID());
  }

  async signUp(
    input: SignUpInput,
    fingerprint: string,
  ): Promise<AcceptedResponse> {
    const now = this.clock.now();
    const email = normalizedEmail(input.email);
    const displayName = normalizedDisplayName(input.displayName);
    const password = normalizedPassword(input.password);
    await this.consumeLimits(
      [
        ["signUpFingerprint", fingerprint],
        ["signUpEmail", email.emailKey],
      ],
      now,
    );
    const passwordHash = await this.passwordHasher.hash(password);
    const issueVerification = this.prepareIssue("verify_email", now);
    await this.repository.registerPending(
      {
        candidateAccountId: this.randomUuid(),
        email: email.email,
        emailKey: email.emailKey,
        displayName,
        passwordHash,
        now,
      },
      issueVerification,
    );
    return { accepted: true };
  }

  async resendVerificationEmail(
    input: ResendVerificationInput,
    fingerprint: string,
  ): Promise<AcceptedResponse> {
    const now = this.clock.now();
    const email = normalizedEmail(input.email);
    await this.consumeLimits(
      [
        ["verificationFingerprint", fingerprint],
        ["verificationEmail", email.emailKey],
      ],
      now,
    );
    const account = await this.repository.findAccountByEmailKey(email.emailKey);
    if (account && !account.emailVerifiedAt) {
      const issue = this.prepareIssue("verify_email", now)(account.id);
      await this.repository.queueVerificationEmail({
        ...issue,
        emailKey: email.emailKey,
        now,
      });
    }
    return { accepted: true };
  }

  async verifyEmail(
    input: VerifyEmailInput,
    fingerprint: string,
  ): Promise<{ verified: true }> {
    const now = this.clock.now();
    await this.consumeLimits([["verificationFingerprint", fingerprint]], now);
    const token = await this.requireActionToken(
      input.token,
      "verify_email",
      now,
    );
    const consumed = await this.repository.consumeEmailVerification({
      tokenId: token.id,
      accountId: token.accountId,
      tokenHash: token.tokenHash,
      now,
    });
    if (!consumed) throw invalidToken();
    return { verified: true };
  }

  async signIn(
    input: SignInInput,
    fingerprint: string,
  ): Promise<CreatedSession> {
    const now = this.clock.now();
    const email = normalizedEmail(input.email);
    await this.consumeLimits(
      [
        ["signInFingerprint", fingerprint],
        ["signInEmail", email.emailKey],
      ],
      now,
    );
    const account = await this.repository.findAccountByEmailKey(email.emailKey);
    if (!account) {
      await this.passwordHasher.verifySynthetic(input.password);
      throw invalidCredentials();
    }
    const verification = await this.passwordHasher.verify(
      input.password,
      account.passwordHash,
    );
    if (!verification.valid || !account.emailVerifiedAt) {
      throw invalidCredentials();
    }

    let expectedPasswordHash = account.passwordHash;
    if (verification.needsRehash) {
      const passwordHash = await this.passwordHasher.hash(input.password);
      const rehashed = await this.repository.rehashPasswordIfCurrent({
        accountId: account.id,
        expectedCredentialVersion: account.credentialVersion,
        expectedPasswordHash: account.passwordHash,
        passwordHash,
        now,
      });
      if (!rehashed) throw invalidCredentials();
      expectedPasswordHash = passwordHash;
    }

    const token = sessionToken(this.randomBytes);
    const idleExpiresAt = new Date(now.getTime() + 7 * DAY_MS);
    const absoluteExpiresAt = new Date(now.getTime() + 30 * DAY_MS);
    const created = await this.repository.createSessionIfCredentialsCurrent({
      id: this.randomUuid(),
      accountId: account.id,
      tokenHash: hashSessionToken(token),
      expectedCredentialVersion: account.credentialVersion,
      expectedPasswordHash,
      idleExpiresAt,
      absoluteExpiresAt,
      now,
    });
    if (!created) throw invalidCredentials();
    return {
      token,
      idleExpiresAt: idleExpiresAt.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
    };
  }

  async resolveSession(token: string): Promise<Principal | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = await this.repository.resolveSession(
      hashSessionToken(token),
      this.clock.now(),
    );
    return session
      ? {
          provider: "local",
          subject: session.accountId,
          displayName: session.email,
          email: session.email,
        }
      : null;
  }

  async signOut(token: string | null): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.repository.revokeSession(
      hashSessionToken(token),
      this.clock.now(),
    );
  }

  async forgotPassword(
    input: ForgotPasswordInput,
    fingerprint: string,
  ): Promise<AcceptedResponse> {
    const now = this.clock.now();
    const email = normalizedEmail(input.email);
    await this.consumeLimits(
      [
        ["forgotFingerprint", fingerprint],
        ["forgotEmail", email.emailKey],
      ],
      now,
    );
    const account = await this.repository.findAccountByEmailKey(email.emailKey);
    if (account?.emailVerifiedAt) {
      const issue = this.prepareIssue("reset_password", now)(account.id);
      await this.repository.queuePasswordReset({
        ...issue,
        emailKey: email.emailKey,
        now,
      });
    }
    return { accepted: true };
  }

  async resetPassword(
    input: ResetPasswordInput,
    fingerprint: string,
  ): Promise<{ reset: true }> {
    const now = this.clock.now();
    const password = normalizedPassword(input.password);
    await this.consumeLimits([["resetFingerprint", fingerprint]], now);
    const token = await this.requireActionToken(
      input.token,
      "reset_password",
      now,
    );
    const passwordHash = await this.passwordHasher.hash(password);
    const reset = await this.repository.resetPasswordAndRevokeSessions({
      tokenId: token.id,
      accountId: token.accountId,
      tokenHash: token.tokenHash,
      passwordHash,
      now,
    });
    if (!reset) throw invalidToken();
    return { reset: true };
  }

  private prepareIssue(purpose: AuthTokenPurpose, now: Date): IssueActionToken {
    const tokenId = this.randomUuid();
    const jobId = this.randomUuid();
    const idempotencyKey = this.randomUuid();
    const expiresAtEpochSeconds = Math.floor(
      (now.getTime() + (purpose === "verify_email" ? 30 : 15) * MINUTE_MS) /
        1000,
    );
    return (accountId) => {
      const claims = {
        id: tokenId,
        accountId,
        purpose,
        signingKeyVersion: this.actionTokenCodec.activeVersion,
        expiresAtEpochSeconds,
      };
      const rawToken = this.actionTokenCodec.create(claims);
      return {
        token: {
          ...claims,
          tokenHash: this.actionTokenCodec.hash(rawToken),
        },
        job: {
          id: jobId,
          accountId,
          authTokenId: tokenId,
          kind: purpose,
          idempotencyKey,
          availableAt: now,
        },
      };
    };
  }

  private async requireActionToken(
    rawToken: string,
    purpose: AuthTokenPurpose,
    now: Date,
  ): Promise<ActionTokenMetadata> {
    const parsed = this.actionTokenCodec.parse(rawToken);
    if (!parsed) throw invalidToken();
    const metadata = await this.repository.findActionToken(parsed.tokenId);
    if (
      !metadata ||
      metadata.purpose !== purpose ||
      metadata.consumedAt ||
      metadata.expiresAtEpochSeconds * 1000 <= now.getTime() ||
      metadata.tokenHash !== this.actionTokenCodec.hash(rawToken) ||
      !this.actionTokenCodec.verify(rawToken, metadata)
    ) {
      throw invalidToken();
    }
    return metadata;
  }

  private async consumeLimits(
    values: ReadonlyArray<readonly [AuthRateLimitScope, string]>,
    now: Date,
  ): Promise<void> {
    for (const [scope, value] of values) {
      if (!value) throw invalidRequest();
      const policy = AUTH_RATE_LIMITS[scope];
      const windowMilliseconds = policy.windowSeconds * 1000;
      const bucketStartedAt = new Date(
        Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds,
      );
      const accepted = await this.repository.consumeRateLimit({
        scope,
        keyHash: rateLimitKey(this.rateLimitSecret, value),
        bucketStartedAt,
        expiresAt: new Date(bucketStartedAt.getTime() + windowMilliseconds),
        limit: policy.limit,
      });
      if (!accepted) throw new RateLimitExceededError("Too many requests");
    }
  }
}

function normalizedEmail(value: string): NormalizedEmail {
  try {
    return normalizeEmail(value);
  } catch {
    throw invalidRequest("Enter a valid email address");
  }
}

function normalizedPassword(value: string): string {
  try {
    return validatePassword(value);
  } catch {
    throw invalidRequest("Password must contain 12–128 Unicode code points");
  }
}

function normalizedDisplayName(value: string): string {
  const displayName = value.trim();
  const length = [...displayName].length;
  if (length < 1 || length > 120) {
    throw invalidRequest("Display name must contain 1–120 Unicode code points");
  }
  return displayName;
}

function sessionToken(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) {
    throw new Error("Session token generator must return 32 bytes");
  }
  return Buffer.from(bytes).toString("base64url");
}

function secureRandomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
