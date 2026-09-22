import type { AuthRepository, EmailJobStore } from "../ports";
import type {
  ActionTokenIssue,
  ActionTokenMetadata,
  AuthAccountForPassword,
  AuthCleanupRequest,
  AuthCleanupResult,
  ClaimedEmailJob,
  EmailJobClaim,
  EmailJobCompletion,
  EmailJobFailure,
  EmailJobRetry,
  IssueActionToken,
  PasswordRehash,
  PasswordResetConsumption,
  PasswordResetRequest,
  PendingRegistration,
  RateLimitAttempt,
  ResolvedAuthSession,
  SessionCreation,
  TokenConsumption,
  VerificationEmailRequest,
} from "../types";

export type InMemoryAuthAccount = AuthAccountForPassword & {
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

type InMemorySession = SessionCreation & {
  lastSeenAt: Date;
  revokedAt: Date | null;
};

type InMemoryEmailJob = ActionTokenIssue["job"] & {
  leasedUntil: Date | null;
  attemptCount: number;
  sentAt: Date | null;
  lastErrorCode: string | null;
};

export class InMemoryAuthRepository implements AuthRepository, EmailJobStore {
  readonly accountsByEmailKey = new Map<string, InMemoryAuthAccount>();
  readonly tokensById = new Map<string, ActionTokenMetadata>();
  readonly sessionsByTokenHash = new Map<string, InMemorySession>();
  readonly jobsById = new Map<string, InMemoryEmailJob>();
  readonly rateLimits = new Map<string, number>();
  beforeCreateSession?: () => Promise<void>;

  async consumeRateLimit(input: RateLimitAttempt): Promise<boolean> {
    const key = [
      input.scope,
      input.keyHash,
      input.bucketStartedAt.toISOString(),
    ].join(":");
    const count = this.rateLimits.get(key) ?? 0;
    if (count >= input.limit) return false;
    this.rateLimits.set(key, count + 1);
    return true;
  }

  async registerPending(
    input: PendingRegistration,
    issueVerification: IssueActionToken,
  ): Promise<{ emailQueued: boolean }> {
    const existing = this.accountsByEmailKey.get(input.emailKey);
    if (existing?.emailVerifiedAt) return { emailQueued: false };
    const accountId = existing?.id ?? input.candidateAccountId;
    const account: InMemoryAuthAccount = existing ?? {
      id: accountId,
      email: input.email,
      emailKey: input.emailKey,
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      credentialVersion: 1,
      displayName: input.displayName,
      createdAt: input.now,
      updatedAt: input.now,
    };
    account.email = input.email;
    account.passwordHash = input.passwordHash;
    account.displayName = input.displayName;
    account.updatedAt = input.now;
    this.accountsByEmailKey.set(input.emailKey, account);
    this.replaceActionIssue(
      issueVerification(accountId),
      accountId,
      "verify_email",
      input.now,
    );
    return { emailQueued: true };
  }

  async queueVerificationEmail(
    input: VerificationEmailRequest,
  ): Promise<boolean> {
    const account = this.accountsByEmailKey.get(input.emailKey);
    if (!account || account.emailVerifiedAt) return false;
    this.replaceActionIssue(input, account.id, "verify_email", input.now);
    return true;
  }

  async findAccountByEmailKey(
    emailKey: string,
  ): Promise<AuthAccountForPassword | null> {
    return this.accountsByEmailKey.get(emailKey) ?? null;
  }

  async findActionToken(id: string): Promise<ActionTokenMetadata | null> {
    return this.tokensById.get(id) ?? null;
  }

  async consumeEmailVerification(input: TokenConsumption): Promise<boolean> {
    const token = this.validToken(input, "verify_email");
    if (!token) return false;
    token.consumedAt = input.now;
    const account = this.accountById(input.accountId);
    if (!account) return false;
    account.emailVerifiedAt ??= input.now;
    account.updatedAt = input.now;
    return true;
  }

  async createSessionIfCredentialsCurrent(
    input: SessionCreation,
  ): Promise<boolean> {
    await this.beforeCreateSession?.();
    const account = this.accountById(input.accountId);
    if (
      !account?.emailVerifiedAt ||
      account.credentialVersion !== input.expectedCredentialVersion ||
      account.passwordHash !== input.expectedPasswordHash
    ) {
      return false;
    }
    this.sessionsByTokenHash.set(input.tokenHash, {
      ...input,
      lastSeenAt: input.now,
      revokedAt: null,
    });
    return true;
  }

  async resolveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ResolvedAuthSession | null> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return null;
    }
    const account = this.accountById(session.accountId);
    if (!account?.emailVerifiedAt) return null;
    if (session.lastSeenAt.getTime() <= now.getTime() - 86_400_000) {
      session.lastSeenAt = now;
      session.idleExpiresAt = new Date(
        Math.min(
          now.getTime() + 7 * 86_400_000,
          session.absoluteExpiresAt.getTime(),
        ),
      );
    }
    return { accountId: account.id, email: account.email };
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (session) session.revokedAt ??= now;
  }

  async queuePasswordReset(input: PasswordResetRequest): Promise<boolean> {
    const account = this.accountsByEmailKey.get(input.emailKey);
    if (!account?.emailVerifiedAt) return false;
    this.replaceActionIssue(input, account.id, "reset_password", input.now);
    return true;
  }

  async rehashPasswordIfCurrent(input: PasswordRehash): Promise<boolean> {
    const account = this.accountById(input.accountId);
    if (
      !account ||
      account.credentialVersion !== input.expectedCredentialVersion ||
      account.passwordHash !== input.expectedPasswordHash
    ) {
      return false;
    }
    account.passwordHash = input.passwordHash;
    account.updatedAt = input.now;
    return true;
  }

  async resetPasswordAndRevokeSessions(
    input: PasswordResetConsumption,
  ): Promise<boolean> {
    const token = this.validToken(input, "reset_password");
    if (!token) return false;
    const account = this.accountById(input.accountId);
    if (!account) return false;
    token.consumedAt = input.now;
    account.passwordHash = input.passwordHash;
    account.credentialVersion += 1;
    account.updatedAt = input.now;
    for (const session of this.sessionsByTokenHash.values()) {
      if (session.accountId === account.id && !session.revokedAt) {
        session.revokedAt = input.now;
      }
    }
    return true;
  }

  async claimEmailJobs(input: EmailJobClaim): Promise<ClaimedEmailJob[]> {
    const eligible = [...this.jobsById.values()]
      .filter(
        (job) =>
          !job.sentAt &&
          job.attemptCount < 8 &&
          job.availableAt <= input.now &&
          (!job.leasedUntil || job.leasedUntil <= input.now),
      )
      .sort(
        (left, right) =>
          left.availableAt.getTime() - right.availableAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit);
    return eligible.map((job) => {
      job.leasedUntil = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      job.attemptCount += 1;
      const token = this.tokensById.get(job.authTokenId);
      const account = this.accountById(job.accountId);
      if (!token || !account || !job.leasedUntil) {
        throw new Error("Email job references missing auth data");
      }
      return {
        id: job.id,
        kind: job.kind,
        email: account.email,
        idempotencyKey: job.idempotencyKey,
        attemptCount: job.attemptCount,
        leasedUntil: job.leasedUntil,
        token,
      };
    });
  }

  async markEmailJobSent(input: EmailJobCompletion): Promise<void> {
    const job = this.jobsById.get(input.id);
    if (job?.leasedUntil?.getTime() === input.leasedUntil.getTime()) {
      job.sentAt = input.now;
      job.leasedUntil = null;
      job.lastErrorCode = null;
    }
  }

  async retryEmailJob(input: EmailJobRetry): Promise<void> {
    const job = this.jobsById.get(input.id);
    if (job?.leasedUntil?.getTime() === input.leasedUntil.getTime()) {
      job.availableAt = input.availableAt;
      job.leasedUntil = null;
      job.lastErrorCode = input.lastErrorCode;
    }
  }

  async failEmailJob(input: EmailJobFailure): Promise<void> {
    const job = this.jobsById.get(input.id);
    if (job?.leasedUntil?.getTime() === input.leasedUntil.getTime()) {
      job.attemptCount = 8;
      job.leasedUntil = null;
      job.lastErrorCode = input.lastErrorCode;
      job.availableAt = input.now;
    }
  }

  async cleanupExpired(input: AuthCleanupRequest): Promise<AuthCleanupResult> {
    return {
      rateLimits: this.deleteLimited(this.rateLimits, () => true, input.limit),
      tokens: this.deleteLimited(
        this.tokensById,
        (token) => token.expiresAtEpochSeconds * 1000 <= input.now.getTime(),
        input.limit,
      ),
      sessions: this.deleteLimited(
        this.sessionsByTokenHash,
        (session) =>
          session.absoluteExpiresAt <= input.now ||
          session.idleExpiresAt <= input.now ||
          session.revokedAt !== null,
        input.limit,
      ),
      emailJobs: this.deleteLimited(
        this.jobsById,
        (job) => job.sentAt !== null || job.attemptCount >= 8,
        input.limit,
      ),
    };
  }

  currentToken(
    purpose: "verify_email" | "reset_password",
  ): ActionTokenMetadata | null {
    return (
      [...this.tokensById.values()]
        .filter((token) => token.purpose === purpose && !token.consumedAt)
        .toSorted((left, right) => right.id.localeCompare(left.id))[0] ?? null
    );
  }

  currentJobs(
    kind: "verification" | "reset" | "verify_email" | "reset_password",
  ) {
    const purpose =
      kind === "verification"
        ? "verify_email"
        : kind === "reset"
          ? "reset_password"
          : kind;
    return [...this.jobsById.values()].filter((job) => {
      const token = this.tokensById.get(job.authTokenId);
      return job.kind === purpose && !job.sentAt && token && !token.consumedAt;
    });
  }

  private replaceActionIssue(
    issue: ActionTokenIssue,
    accountId: string,
    purpose: "verify_email" | "reset_password",
    now: Date,
  ): void {
    validateIssue(issue, accountId, purpose);
    for (const token of this.tokensById.values()) {
      if (
        token.accountId === accountId &&
        token.purpose === purpose &&
        !token.consumedAt
      ) {
        token.consumedAt = now;
        for (const [jobId, job] of this.jobsById) {
          if (job.authTokenId === token.id && !job.sentAt) {
            this.jobsById.delete(jobId);
          }
        }
      }
    }
    this.tokensById.set(issue.token.id, {
      ...issue.token,
      consumedAt: null,
    });
    this.jobsById.set(issue.job.id, {
      ...issue.job,
      leasedUntil: null,
      attemptCount: 0,
      sentAt: null,
      lastErrorCode: null,
    });
  }

  private validToken(
    input: TokenConsumption | PasswordResetConsumption,
    purpose: "verify_email" | "reset_password",
  ): ActionTokenMetadata | null {
    const token = this.tokensById.get(input.tokenId);
    if (
      !token ||
      token.accountId !== input.accountId ||
      token.purpose !== purpose ||
      token.tokenHash !== input.tokenHash ||
      token.consumedAt ||
      token.expiresAtEpochSeconds * 1000 <= input.now.getTime()
    ) {
      return null;
    }
    return token;
  }

  private accountById(id: string): InMemoryAuthAccount | null {
    return (
      [...this.accountsByEmailKey.values()].find(
        (account) => account.id === id,
      ) ?? null
    );
  }

  private deleteLimited<T>(
    map: Map<string, T>,
    predicate: (value: T) => boolean,
    limit: number,
  ): number {
    let deleted = 0;
    for (const [key, value] of map) {
      if (deleted >= limit) break;
      if (predicate(value)) {
        map.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

function validateIssue(
  issue: ActionTokenIssue,
  accountId: string,
  purpose: "verify_email" | "reset_password",
): void {
  if (
    issue.token.accountId !== accountId ||
    issue.token.purpose !== purpose ||
    issue.job.accountId !== accountId ||
    issue.job.authTokenId !== issue.token.id ||
    issue.job.kind !== purpose
  ) {
    throw new Error("Action-token issue does not match the account");
  }
}
