import type {
  ActionTokenClaims,
  ActionTokenMetadata,
  AuthAccountForPassword,
  AuthCleanupRequest,
  AuthCleanupResult,
  ClaimedEmailJob,
  EmailJobClaim,
  EmailJobCompletion,
  EmailJobRetry,
  IssueActionToken,
  ParsedActionToken,
  PasswordRehash,
  PasswordResetConsumption,
  PasswordResetRequest,
  PendingRegistration,
  RateLimitAttempt,
  ResolvedAuthSession,
  SessionCreation,
  TokenConsumption,
  VerificationEmailRequest,
} from "./types";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(
    password: string,
    envelope: string,
  ): Promise<{ valid: boolean; needsRehash: boolean }>;
  verifySynthetic(password: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface ActionTokenCodec {
  readonly activeVersion: number;
  create(claims: ActionTokenClaims): string;
  parse(token: string): ParsedActionToken | null;
  verify(token: string, claims: ActionTokenClaims): boolean;
  hash(token: string): string;
}

export interface AuthRepository {
  consumeRateLimit(input: RateLimitAttempt): Promise<boolean>;
  registerPending(
    input: PendingRegistration,
    issueVerification: IssueActionToken,
  ): Promise<{ emailQueued: boolean }>;
  queueVerificationEmail(input: VerificationEmailRequest): Promise<boolean>;
  findAccountByEmailKey(
    emailKey: string,
  ): Promise<AuthAccountForPassword | null>;
  findActionToken(id: string): Promise<ActionTokenMetadata | null>;
  consumeEmailVerification(input: TokenConsumption): Promise<boolean>;
  createSessionIfCredentialsCurrent(input: SessionCreation): Promise<boolean>;
  resolveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ResolvedAuthSession | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  queuePasswordReset(input: PasswordResetRequest): Promise<boolean>;
  rehashPasswordIfCurrent(input: PasswordRehash): Promise<boolean>;
  resetPasswordAndRevokeSessions(
    input: PasswordResetConsumption,
  ): Promise<boolean>;
}

export interface EmailJobStore {
  claimEmailJobs(input: EmailJobClaim): Promise<ClaimedEmailJob[]>;
  markEmailJobSent(input: EmailJobCompletion): Promise<void>;
  retryEmailJob(input: EmailJobRetry): Promise<void>;
  cleanupExpired(input: AuthCleanupRequest): Promise<AuthCleanupResult>;
}
