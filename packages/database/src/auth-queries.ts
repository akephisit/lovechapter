import type {
  ActionTokenClaims,
  ActionTokenIssue,
  AuthCleanupRequest,
  EmailJobClaim,
  EmailJobCompletion,
  EmailJobFailure,
  EmailJobRetry,
  PasswordRehash,
  PasswordResetConsumption,
  PendingRegistration,
  RateLimitAttempt,
  SessionCreation,
  TokenConsumption,
} from "@lovechapter/auth";
import { sql, type SQL } from "drizzle-orm";

import {
  authAccounts,
  authEmailJobs,
  authRateLimits,
  authSessions,
  authTokens,
  users,
} from "./schema";

export function buildConsumeRateLimitQuery(input: RateLimitAttempt): SQL {
  return sql`insert into ${authRateLimits}
      (${sql.identifier(authRateLimits.scope.name)}, ${sql.identifier(authRateLimits.keyHash.name)}, ${sql.identifier(authRateLimits.bucketStartedAt.name)}, ${sql.identifier(authRateLimits.count.name)}, ${sql.identifier(authRateLimits.expiresAt.name)})
    values (${input.scope}, ${input.keyHash}, ${input.bucketStartedAt}, 1, ${input.expiresAt})
    on conflict ("scope", "key_hash", "bucket_started_at") do update set
      "count" = ${authRateLimits.count} + 1,
      "expires_at" = excluded."expires_at"
    where ${authRateLimits.count} < ${input.limit}
    returning ${authRateLimits.count} as "count"`;
}

export function buildUpsertPendingAccountQuery(
  input: PendingRegistration,
): SQL {
  return sql`insert into ${authAccounts}
      (${sql.identifier(authAccounts.id.name)}, ${sql.identifier(authAccounts.email.name)}, ${sql.identifier(authAccounts.emailKey.name)}, ${sql.identifier(authAccounts.passwordHash.name)}, ${sql.identifier(authAccounts.credentialVersion.name)}, ${sql.identifier(authAccounts.createdAt.name)}, ${sql.identifier(authAccounts.updatedAt.name)})
    values (${input.candidateAccountId}, ${input.email}, ${input.emailKey}, ${input.passwordHash}, 1, ${input.now}, ${input.now})
    on conflict ("email_key") do update set
      "email" = excluded."email",
      "password_hash" = excluded."password_hash",
      "updated_at" = excluded."updated_at"
    where ${authAccounts.emailVerifiedAt} is null
    returning ${authAccounts.id} as "id"`;
}

export function buildSeedLocalUserQuery(input: {
  accountId: string;
  displayName: string;
  email: string;
  now: Date;
}): SQL {
  return sql`insert into ${users}
      (${sql.identifier(users.id.name)}, ${sql.identifier(users.authProvider.name)}, ${sql.identifier(users.authSubject.name)}, ${sql.identifier(users.displayName.name)}, ${sql.identifier(users.email.name)}, ${sql.identifier(users.onboardingCompletedAt.name)}, ${sql.identifier(users.createdAt.name)}, ${sql.identifier(users.updatedAt.name)})
    values (${input.accountId}, 'local', ${input.accountId}, ${input.displayName}, ${input.email}, ${input.now}, ${input.now}, ${input.now})
    on conflict ("auth_provider", "auth_subject") do update set
      "display_name" = excluded."display_name",
      "email" = excluded."email",
      "onboarding_completed_at" = excluded."onboarding_completed_at",
      "updated_at" = excluded."updated_at"`;
}

export function buildInvalidateTokensAndJobsQuery(input: {
  accountId: string;
  purpose: "verify_email" | "reset_password";
  now: Date;
}): SQL {
  return sql`with "invalidated_tokens" as (
      update ${authTokens}
      set ${sql.identifier(authTokens.consumedAt.name)} = ${input.now}
      where ${authTokens.accountId} = ${input.accountId}
        and ${authTokens.purpose} = ${input.purpose}
        and ${authTokens.consumedAt} is null
      returning ${authTokens.id} as "id"
    )
    delete from ${authEmailJobs}
    using "invalidated_tokens"
    where ${authEmailJobs.authTokenId} = "invalidated_tokens"."id"
      and ${authEmailJobs.sentAt} is null`;
}

export function buildInsertActionTokenQuery(
  token: ActionTokenClaims & { tokenHash: string },
  createdAt: Date,
): SQL {
  return sql`insert into ${authTokens}
      (${sql.identifier(authTokens.id.name)}, ${sql.identifier(authTokens.accountId.name)}, ${sql.identifier(authTokens.purpose.name)}, ${sql.identifier(authTokens.tokenHash.name)}, ${sql.identifier(authTokens.signingKeyVersion.name)}, ${sql.identifier(authTokens.expiresAt.name)}, ${sql.identifier(authTokens.createdAt.name)})
    values (${token.id}, ${token.accountId}, ${token.purpose}, ${token.tokenHash}, ${token.signingKeyVersion}, ${new Date(token.expiresAtEpochSeconds * 1000)}, ${createdAt})`;
}

export function buildInsertEmailJobQuery(
  issue: ActionTokenIssue,
  createdAt: Date,
): SQL {
  return sql`insert into ${authEmailJobs}
      (${sql.identifier(authEmailJobs.id.name)}, ${sql.identifier(authEmailJobs.kind.name)}, ${sql.identifier(authEmailJobs.accountId.name)}, ${sql.identifier(authEmailJobs.authTokenId.name)}, ${sql.identifier(authEmailJobs.idempotencyKey.name)}, ${sql.identifier(authEmailJobs.availableAt.name)}, ${sql.identifier(authEmailJobs.createdAt.name)}, ${sql.identifier(authEmailJobs.updatedAt.name)})
    values (${issue.job.id}, ${issue.job.kind}, ${issue.job.accountId}, ${issue.job.authTokenId}, ${issue.job.idempotencyKey}, ${issue.job.availableAt}, ${createdAt}, ${createdAt})`;
}

export function buildFindEligibleAccountForEmailQuery(emailKey: string): SQL {
  return sql`select
      ${authAccounts.id} as "id"
    from ${authAccounts}
    where ${authAccounts.emailKey} = ${emailKey}
      and ${authAccounts.emailVerifiedAt} is null
    limit 1
    for update`;
}

export function buildFindResetEligibleAccountForEmailQuery(
  emailKey: string,
): SQL {
  return sql`select
      ${authAccounts.id} as "id"
    from ${authAccounts}
    where ${authAccounts.emailKey} = ${emailKey}
      and ${authAccounts.emailVerifiedAt} is not null
    limit 1
    for update`;
}

export function buildFindAccountByEmailKeyQuery(emailKey: string): SQL {
  return sql`select
      ${authAccounts.id} as "id",
      ${authAccounts.email} as "email",
      ${authAccounts.emailKey} as "email_key",
      ${authAccounts.passwordHash} as "password_hash",
      ${authAccounts.emailVerifiedAt} as "email_verified_at",
      ${authAccounts.credentialVersion} as "credential_version"
    from ${authAccounts}
    where ${authAccounts.emailKey} = ${emailKey}
    limit 1`;
}

export function buildFindActionTokenQuery(id: string): SQL {
  return sql`select
      ${authTokens.id} as "id",
      ${authTokens.accountId} as "account_id",
      ${authTokens.purpose} as "purpose",
      ${authTokens.tokenHash} as "token_hash",
      ${authTokens.signingKeyVersion} as "signing_key_version",
      ${authTokens.expiresAt} as "expires_at",
      ${authTokens.consumedAt} as "consumed_at"
    from ${authTokens}
    where ${authTokens.id} = ${id}
    limit 1`;
}

export function buildConsumeEmailVerificationQuery(
  input: TokenConsumption,
): SQL {
  return sql`with "consumed_token" as (
      update ${authTokens}
      set ${sql.identifier(authTokens.consumedAt.name)} = ${input.now}
      where ${authTokens.id} = ${input.tokenId}
        and ${authTokens.accountId} = ${input.accountId}
        and ${authTokens.tokenHash} = ${input.tokenHash}
        and ${authTokens.purpose} = 'verify_email'
        and ${authTokens.consumedAt} is null
        and ${authTokens.expiresAt} > ${input.now}
      returning ${authTokens.accountId} as "account_id"
    ), "verified_account" as (
      update ${authAccounts}
      set ${sql.identifier(authAccounts.emailVerifiedAt.name)} = coalesce(${authAccounts.emailVerifiedAt}, ${input.now}),
          ${sql.identifier(authAccounts.updatedAt.name)} = ${input.now}
      from "consumed_token"
      where ${authAccounts.id} = "consumed_token"."account_id"
      returning ${authAccounts.id} as "id"
    )
    select "id" from "verified_account"`;
}

export function buildCreateSessionIfCredentialsCurrentQuery(
  input: SessionCreation,
): SQL {
  return sql`with "eligible_account" as (
      select ${authAccounts.id} as "id"
      from ${authAccounts}
      where ${authAccounts.id} = ${input.accountId}
        and ${authAccounts.credentialVersion} = ${input.expectedCredentialVersion}
        and ${authAccounts.passwordHash} = ${input.expectedPasswordHash}
        and ${authAccounts.emailVerifiedAt} is not null
      for update
    )
    insert into ${authSessions}
      (${sql.identifier(authSessions.id.name)}, ${sql.identifier(authSessions.accountId.name)}, ${sql.identifier(authSessions.tokenHash.name)}, ${sql.identifier(authSessions.idleExpiresAt.name)}, ${sql.identifier(authSessions.absoluteExpiresAt.name)}, ${sql.identifier(authSessions.lastSeenAt.name)}, ${sql.identifier(authSessions.createdAt.name)})
    select ${input.id}, "eligible_account"."id", ${input.tokenHash}, ${input.idleExpiresAt}, ${input.absoluteExpiresAt}, ${input.now}, ${input.now}
    from "eligible_account"
    returning ${authSessions.id} as "id"`;
}

export function buildResolveSessionQuery(tokenHash: string, now: Date): SQL {
  return sql`with "valid_session" as (
      select
        ${authSessions.id} as "session_id",
        ${authAccounts.id} as "account_id",
        ${authAccounts.email} as "email"
      from ${authSessions}
      inner join ${authAccounts}
        on ${authAccounts.id} = ${authSessions.accountId}
      where ${authSessions.tokenHash} = ${tokenHash}
        and ${authSessions.revokedAt} is null
        and ${authSessions.idleExpiresAt} > ${now}
        and ${authSessions.absoluteExpiresAt} > ${now}
        and ${authAccounts.emailVerifiedAt} is not null
      limit 1
    ), "refreshed_session" as (
      update ${authSessions}
      set ${sql.identifier(authSessions.lastSeenAt.name)} = ${now},
          ${sql.identifier(authSessions.idleExpiresAt.name)} = least((${now}::timestamptz) + interval '7 days', ${authSessions.absoluteExpiresAt})
      from "valid_session"
      where ${authSessions.id} = "valid_session"."session_id"
        and ${authSessions.lastSeenAt} <= (${now}::timestamptz) - interval '24 hours'
      returning "valid_session"."account_id", "valid_session"."email"
    )
    select "account_id", "email" from "refreshed_session"
    union all
    select "account_id", "email" from "valid_session"
    where not exists (select 1 from "refreshed_session")
    limit 1`;
}

export function buildRevokeSessionQuery(tokenHash: string, now: Date): SQL {
  return sql`update ${authSessions}
    set ${sql.identifier(authSessions.revokedAt.name)} = coalesce(${authSessions.revokedAt}, ${now})
    where ${authSessions.tokenHash} = ${tokenHash}`;
}

export function buildRehashPasswordIfCurrentQuery(input: PasswordRehash): SQL {
  return sql`update ${authAccounts}
    set ${sql.identifier(authAccounts.passwordHash.name)} = ${input.passwordHash},
        ${sql.identifier(authAccounts.updatedAt.name)} = ${input.now}
    where ${authAccounts.id} = ${input.accountId}
      and ${authAccounts.credentialVersion} = ${input.expectedCredentialVersion}
      and ${authAccounts.passwordHash} = ${input.expectedPasswordHash}
    returning ${authAccounts.id} as "id"`;
}

export function buildConsumePasswordResetQuery(
  input: PasswordResetConsumption,
): SQL {
  return sql`update ${authTokens}
    set ${sql.identifier(authTokens.consumedAt.name)} = ${input.now}
    where ${authTokens.id} = ${input.tokenId}
      and ${authTokens.accountId} = ${input.accountId}
      and ${authTokens.tokenHash} = ${input.tokenHash}
      and ${authTokens.purpose} = 'reset_password'
      and ${authTokens.consumedAt} is null
      and ${authTokens.expiresAt} > ${input.now}
    returning ${authTokens.accountId} as "account_id"`;
}

export function buildUpdatePasswordQuery(
  accountId: string,
  passwordHash: string,
  now: Date,
): SQL {
  return sql`update ${authAccounts}
    set ${sql.identifier(authAccounts.passwordHash.name)} = ${passwordHash},
        ${sql.identifier(authAccounts.credentialVersion.name)} = ${authAccounts.credentialVersion} + 1,
        ${sql.identifier(authAccounts.updatedAt.name)} = ${now}
    where ${authAccounts.id} = ${accountId}
    returning ${authAccounts.id} as "id"`;
}

export function buildRevokeAccountSessionsQuery(
  accountId: string,
  now: Date,
): SQL {
  return sql`update ${authSessions}
    set ${sql.identifier(authSessions.revokedAt.name)} = ${now}
    where ${authSessions.accountId} = ${accountId}
      and ${authSessions.revokedAt} is null`;
}

export function buildClaimEmailJobsQuery(input: EmailJobClaim): SQL {
  const leasedUntil = new Date(input.now.getTime() + input.leaseSeconds * 1000);
  return sql`with "claimable" as (
      select ${authEmailJobs.id} as "id"
      from ${authEmailJobs}
      where ${authEmailJobs.sentAt} is null
        and ${authEmailJobs.attemptCount} < 8
        and ${authEmailJobs.availableAt} <= ${input.now}
        and (${authEmailJobs.leasedUntil} is null or ${authEmailJobs.leasedUntil} <= ${input.now})
      order by ${authEmailJobs.availableAt}, ${authEmailJobs.id}
      limit ${input.limit}
      for update skip locked
    ), "claimed" as (
      update ${authEmailJobs}
      set ${sql.identifier(authEmailJobs.leasedUntil.name)} = ${leasedUntil},
          ${sql.identifier(authEmailJobs.attemptCount.name)} = ${authEmailJobs.attemptCount} + 1,
          ${sql.identifier(authEmailJobs.updatedAt.name)} = ${input.now}
      from "claimable"
      where ${authEmailJobs.id} = "claimable"."id"
      returning
        ${authEmailJobs.id} as "id",
        ${authEmailJobs.kind} as "kind",
        ${authEmailJobs.accountId} as "account_id",
        ${authEmailJobs.authTokenId} as "auth_token_id",
        ${authEmailJobs.idempotencyKey} as "idempotency_key",
        ${authEmailJobs.attemptCount} as "attempt_count",
        ${authEmailJobs.leasedUntil} as "leased_until"
    )
    select
      "claimed"."id",
      "claimed"."kind",
      ${authAccounts.email} as "email",
      "claimed"."idempotency_key",
      "claimed"."attempt_count",
      "claimed"."leased_until",
      ${authTokens.id} as "token_id",
      ${authTokens.accountId} as "account_id",
      ${authTokens.purpose} as "purpose",
      ${authTokens.tokenHash} as "token_hash",
      ${authTokens.signingKeyVersion} as "signing_key_version",
      ${authTokens.expiresAt} as "expires_at",
      ${authTokens.consumedAt} as "consumed_at"
    from "claimed"
    inner join ${authTokens} on ${authTokens.id} = "claimed"."auth_token_id"
    inner join ${authAccounts} on ${authAccounts.id} = "claimed"."account_id"
    order by "claimed"."id"`;
}

export function buildMarkEmailJobSentQuery(input: EmailJobCompletion): SQL {
  return sql`update ${authEmailJobs}
    set ${sql.identifier(authEmailJobs.sentAt.name)} = ${input.now},
        ${sql.identifier(authEmailJobs.leasedUntil.name)} = null,
        ${sql.identifier(authEmailJobs.lastErrorCode.name)} = null,
        ${sql.identifier(authEmailJobs.updatedAt.name)} = ${input.now}
    where ${authEmailJobs.id} = ${input.id}
      and ${authEmailJobs.leasedUntil} = ${input.leasedUntil}`;
}

export function buildRetryEmailJobQuery(input: EmailJobRetry): SQL {
  return sql`update ${authEmailJobs}
    set ${sql.identifier(authEmailJobs.availableAt.name)} = ${input.availableAt},
        ${sql.identifier(authEmailJobs.leasedUntil.name)} = null,
        ${sql.identifier(authEmailJobs.lastErrorCode.name)} = ${input.lastErrorCode},
        ${sql.identifier(authEmailJobs.updatedAt.name)} = ${input.now}
    where ${authEmailJobs.id} = ${input.id}
      and ${authEmailJobs.leasedUntil} = ${input.leasedUntil}`;
}

export function buildFailEmailJobQuery(input: EmailJobFailure): SQL {
  return sql`update ${authEmailJobs}
    set ${sql.identifier(authEmailJobs.attemptCount.name)} = 8,
        ${sql.identifier(authEmailJobs.leasedUntil.name)} = null,
        ${sql.identifier(authEmailJobs.lastErrorCode.name)} = ${input.lastErrorCode},
        ${sql.identifier(authEmailJobs.updatedAt.name)} = ${input.now}
    where ${authEmailJobs.id} = ${input.id}
      and ${authEmailJobs.leasedUntil} = ${input.leasedUntil}`;
}

export type AuthCleanupTable =
  "rate_limits" | "tokens" | "sessions" | "email_jobs";

export function buildCleanupQuery(
  table: AuthCleanupTable,
  input: AuthCleanupRequest,
): SQL {
  const sevenDaysAgo = new Date(input.now.getTime() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(input.now.getTime() - 30 * 86_400_000);
  if (table === "rate_limits") {
    return sql`delete from ${authRateLimits}
      where (${authRateLimits.scope}, ${authRateLimits.keyHash}, ${authRateLimits.bucketStartedAt}) in (
        select ${authRateLimits.scope}, ${authRateLimits.keyHash}, ${authRateLimits.bucketStartedAt}
        from ${authRateLimits}
        where ${authRateLimits.expiresAt} <= ${input.now}
        order by ${authRateLimits.expiresAt}, ${authRateLimits.scope}, ${authRateLimits.keyHash}, ${authRateLimits.bucketStartedAt}
        limit ${input.limit}
      )
      returning ${authRateLimits.keyHash} as "id"`;
  }
  if (table === "tokens") {
    return sql`delete from ${authTokens}
      where ${authTokens.id} in (
        select ${authTokens.id} from ${authTokens}
        where ${authTokens.expiresAt} <= ${sevenDaysAgo}
           or ${authTokens.consumedAt} <= ${sevenDaysAgo}
        order by ${authTokens.expiresAt}, ${authTokens.id}
        limit ${input.limit}
      )
      returning ${authTokens.id} as "id"`;
  }
  if (table === "sessions") {
    return sql`delete from ${authSessions}
      where ${authSessions.id} in (
        select ${authSessions.id} from ${authSessions}
        where ${authSessions.absoluteExpiresAt} <= ${thirtyDaysAgo}
           or ${authSessions.idleExpiresAt} <= ${thirtyDaysAgo}
           or ${authSessions.revokedAt} <= ${thirtyDaysAgo}
        order by ${authSessions.absoluteExpiresAt}, ${authSessions.id}
        limit ${input.limit}
      )
      returning ${authSessions.id} as "id"`;
  }
  return sql`delete from ${authEmailJobs}
    where ${authEmailJobs.id} in (
      select ${authEmailJobs.id} from ${authEmailJobs}
      where ${authEmailJobs.sentAt} <= ${sevenDaysAgo}
         or (${authEmailJobs.attemptCount} >= 8 and ${authEmailJobs.updatedAt} <= ${sevenDaysAgo})
      order by ${authEmailJobs.updatedAt}, ${authEmailJobs.id}
      limit ${input.limit}
    )
    returning ${authEmailJobs.id} as "id"`;
}
