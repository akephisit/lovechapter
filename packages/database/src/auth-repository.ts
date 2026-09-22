import type {
  ActionTokenIssue,
  ActionTokenMetadata,
  AuthAccountForPassword,
  AuthCleanupRequest,
  AuthCleanupResult,
  AuthRepository,
  ClaimedEmailJob,
  EmailJobClaim,
  EmailJobCompletion,
  EmailJobRetry,
  EmailJobStore,
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
} from "@lovechapter/auth";

import {
  buildClaimEmailJobsQuery,
  buildCleanupQuery,
  buildConsumeEmailVerificationQuery,
  buildConsumePasswordResetQuery,
  buildConsumeRateLimitQuery,
  buildCreateSessionIfCredentialsCurrentQuery,
  buildFindAccountByEmailKeyQuery,
  buildFindActionTokenQuery,
  buildFindEligibleAccountForEmailQuery,
  buildFindResetEligibleAccountForEmailQuery,
  buildInsertActionTokenQuery,
  buildInsertEmailJobQuery,
  buildInvalidateTokensAndJobsQuery,
  buildMarkEmailJobSentQuery,
  buildRehashPasswordIfCurrentQuery,
  buildRevokeAccountSessionsQuery,
  buildResolveSessionQuery,
  buildRetryEmailJobQuery,
  buildRevokeSessionQuery,
  buildSeedLocalUserQuery,
  buildUpsertPendingAccountQuery,
  buildUpdatePasswordQuery,
  type AuthCleanupTable,
} from "./auth-queries";
import type { QueryExecutor } from "./repository";

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly executor: QueryExecutor) {}

  async consumeRateLimit(input: RateLimitAttempt): Promise<boolean> {
    const result = await this.executor.execute<{ count: number }>(
      buildConsumeRateLimitQuery(input),
    );
    return result.rows.length === 1;
  }

  registerPending(
    input: PendingRegistration,
    issueVerification: IssueActionToken,
  ): Promise<{ emailQueued: boolean }> {
    return this.executor.transaction(async (transaction) => {
      const accountResult = await transaction.execute<{ id: string }>(
        buildUpsertPendingAccountQuery(input),
      );
      const accountId = accountResult.rows[0]?.id;
      if (!accountId) return { emailQueued: false };

      const issue = issueVerification(accountId);
      validateIssue(issue, accountId, "verify_email");
      await transaction.execute(
        buildSeedLocalUserQuery({
          accountId,
          displayName: input.displayName,
          email: input.email,
          now: input.now,
        }),
      );
      await transaction.execute(
        buildInvalidateTokensAndJobsQuery({
          accountId,
          purpose: "verify_email",
          now: input.now,
        }),
      );
      await transaction.execute(
        buildInsertActionTokenQuery(issue.token, input.now),
      );
      await transaction.execute(buildInsertEmailJobQuery(issue, input.now));
      return { emailQueued: true };
    });
  }

  queueVerificationEmail(input: VerificationEmailRequest): Promise<boolean> {
    return this.queueActionEmail(input, "verify_email", false);
  }

  async findAccountByEmailKey(
    emailKey: string,
  ): Promise<AuthAccountForPassword | null> {
    const result = await this.executor.execute<AuthAccountRow>(
      buildFindAccountByEmailKeyQuery(emailKey),
    );
    const row = result.rows[0];
    return row ? mapAccount(row) : null;
  }

  async findActionToken(id: string): Promise<ActionTokenMetadata | null> {
    const result = await this.executor.execute<ActionTokenRow>(
      buildFindActionTokenQuery(id),
    );
    const row = result.rows[0];
    return row ? mapActionToken(row) : null;
  }

  async consumeEmailVerification(input: TokenConsumption): Promise<boolean> {
    const result = await this.executor.execute<{ id: string }>(
      buildConsumeEmailVerificationQuery(input),
    );
    return result.rows.length === 1;
  }

  async createSessionIfCredentialsCurrent(
    input: SessionCreation,
  ): Promise<boolean> {
    const result = await this.executor.execute<{ id: string }>(
      buildCreateSessionIfCredentialsCurrentQuery(input),
    );
    return result.rows.length === 1;
  }

  async resolveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ResolvedAuthSession | null> {
    const result = await this.executor.execute<ResolvedSessionRow>(
      buildResolveSessionQuery(tokenHash, now),
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, email: row.email } : null;
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.executor.execute(buildRevokeSessionQuery(tokenHash, now));
  }

  queuePasswordReset(input: PasswordResetRequest): Promise<boolean> {
    return this.queueActionEmail(input, "reset_password", true);
  }

  async rehashPasswordIfCurrent(input: PasswordRehash): Promise<boolean> {
    const result = await this.executor.execute<{ id: string }>(
      buildRehashPasswordIfCurrentQuery(input),
    );
    return result.rows.length === 1;
  }

  async resetPasswordAndRevokeSessions(
    input: PasswordResetConsumption,
  ): Promise<boolean> {
    return this.executor.transaction(async (transaction) => {
      const consumed = await transaction.execute<{ account_id: string }>(
        buildConsumePasswordResetQuery(input),
      );
      if (consumed.rows[0]?.account_id !== input.accountId) return false;
      const updated = await transaction.execute<{ id: string }>(
        buildUpdatePasswordQuery(
          input.accountId,
          input.passwordHash,
          input.now,
        ),
      );
      if (updated.rows[0]?.id !== input.accountId) {
        throw new Error("Password-reset account update failed");
      }
      await transaction.execute(
        buildRevokeAccountSessionsQuery(input.accountId, input.now),
      );
      return true;
    });
  }

  private queueActionEmail(
    input: VerificationEmailRequest | PasswordResetRequest,
    purpose: "verify_email" | "reset_password",
    verified: boolean,
  ): Promise<boolean> {
    return this.executor.transaction(async (transaction) => {
      const accountResult = await transaction.execute<{ id: string }>(
        verified
          ? buildFindResetEligibleAccountForEmailQuery(input.emailKey)
          : buildFindEligibleAccountForEmailQuery(input.emailKey),
      );
      const accountId = accountResult.rows[0]?.id;
      if (!accountId) return false;
      validateIssue(input, accountId, purpose);
      await transaction.execute(
        buildInvalidateTokensAndJobsQuery({
          accountId,
          purpose,
          now: input.now,
        }),
      );
      await transaction.execute(
        buildInsertActionTokenQuery(input.token, input.now),
      );
      await transaction.execute(buildInsertEmailJobQuery(input, input.now));
      return true;
    });
  }
}

export class PostgresEmailJobStore implements EmailJobStore {
  constructor(private readonly executor: QueryExecutor) {}

  async claimEmailJobs(input: EmailJobClaim): Promise<ClaimedEmailJob[]> {
    boundedLimit(input.limit, 10, "Email job claim limit");
    if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
      throw new Error("Email job lease must be a positive number of seconds");
    }
    const result = await this.executor.execute<ClaimedEmailJobRow>(
      buildClaimEmailJobsQuery(input),
    );
    return result.rows.map(mapClaimedEmailJob);
  }

  async markEmailJobSent(input: EmailJobCompletion): Promise<void> {
    await this.executor.execute(buildMarkEmailJobSentQuery(input));
  }

  async retryEmailJob(input: EmailJobRetry): Promise<void> {
    if (!/^[a-z0-9_:-]{1,64}$/i.test(input.lastErrorCode)) {
      throw new Error("Email job error code must be sanitized");
    }
    await this.executor.execute(buildRetryEmailJobQuery(input));
  }

  cleanupExpired(input: AuthCleanupRequest): Promise<AuthCleanupResult> {
    boundedLimit(input.limit, 1_000, "Auth cleanup limit");
    return this.executor.transaction(async (transaction) => {
      const tables: AuthCleanupTable[] = [
        "rate_limits",
        "tokens",
        "sessions",
        "email_jobs",
      ];
      const counts: number[] = [];
      for (const table of tables) {
        const result = await transaction.execute<{ id: string }>(
          buildCleanupQuery(table, input),
        );
        counts.push(result.rows.length);
      }
      return {
        rateLimits: counts[0] ?? 0,
        tokens: counts[1] ?? 0,
        sessions: counts[2] ?? 0,
        emailJobs: counts[3] ?? 0,
      };
    });
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
    throw new Error("Action-token issue does not match the locked account");
  }
}

function mapAccount(row: AuthAccountRow): AuthAccountForPassword {
  return {
    id: row.id,
    email: row.email,
    emailKey: row.email_key,
    passwordHash: row.password_hash,
    emailVerifiedAt: nullableDate(row.email_verified_at),
    credentialVersion: Number(row.credential_version),
  };
}

function mapActionToken(row: ActionTokenRow): ActionTokenMetadata {
  return {
    id: row.id,
    accountId: row.account_id,
    purpose: row.purpose,
    signingKeyVersion: Number(row.signing_key_version),
    expiresAtEpochSeconds: Math.floor(asDate(row.expires_at).getTime() / 1000),
    tokenHash: row.token_hash,
    consumedAt: nullableDate(row.consumed_at),
  };
}

function mapClaimedEmailJob(row: ClaimedEmailJobRow): ClaimedEmailJob {
  if (row.kind !== row.purpose) {
    throw new Error("Claimed email job purpose does not match its token");
  }
  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    idempotencyKey: row.idempotency_key,
    attemptCount: Number(row.attempt_count),
    leasedUntil: asDate(row.leased_until),
    token: mapActionToken({
      id: row.token_id,
      account_id: row.account_id,
      purpose: row.kind,
      token_hash: row.token_hash,
      signing_key_version: row.signing_key_version,
      expires_at: row.expires_at,
      consumed_at: row.consumed_at,
    }),
  };
}

function boundedLimit(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Database returned an invalid date");
  return date;
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

type AuthAccountRow = {
  id: string;
  email: string;
  email_key: string;
  password_hash: string;
  email_verified_at: Date | string | null;
  credential_version: number | string;
};

type ActionTokenRow = {
  id: string;
  account_id: string;
  purpose: "verify_email" | "reset_password";
  token_hash: string;
  signing_key_version: number | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
};

type ResolvedSessionRow = { account_id: string; email: string };

type ClaimedEmailJobRow = {
  id: string;
  kind: "verify_email" | "reset_password";
  purpose: "verify_email" | "reset_password";
  email: string;
  idempotency_key: string;
  attempt_count: number | string;
  leased_until: Date | string;
  token_id: string;
  account_id: string;
  token_hash: string;
  signing_key_version: number | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
};
