export type AuthTokenPurpose = "verify_email" | "reset_password";

export type ActionTokenClaims = {
  id: string;
  accountId: string;
  purpose: AuthTokenPurpose;
  signingKeyVersion: number;
  expiresAtEpochSeconds: number;
};

export type ActionTokenMetadata = ActionTokenClaims & {
  tokenHash: string;
  consumedAt: Date | null;
};

export type ParsedActionToken = {
  keyVersion: number;
  tokenId: string;
  expiryEpochSeconds: number;
  mac: Uint8Array;
};

export type ActionTokenIssue = {
  token: ActionTokenClaims & { tokenHash: string };
  job: {
    id: string;
    accountId: string;
    authTokenId: string;
    kind: AuthTokenPurpose;
    idempotencyKey: string;
    availableAt: Date;
  };
};

export type IssueActionToken = (accountId: string) => ActionTokenIssue;

export type AuthRateLimitScope =
  | "signUpFingerprint"
  | "signUpEmail"
  | "signInFingerprint"
  | "signInEmail"
  | "verificationFingerprint"
  | "verificationEmail"
  | "forgotFingerprint"
  | "forgotEmail"
  | "resetFingerprint";

export type RateLimitAttempt = {
  scope: AuthRateLimitScope;
  keyHash: string;
  bucketStartedAt: Date;
  expiresAt: Date;
  limit: number;
};

export type PendingRegistration = {
  candidateAccountId: string;
  email: string;
  emailKey: string;
  displayName: string;
  passwordHash: string;
  now: Date;
};

export type VerificationEmailRequest = ActionTokenIssue & {
  emailKey: string;
  now: Date;
};

export type AuthAccountForPassword = {
  id: string;
  email: string;
  emailKey: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  credentialVersion: number;
};

export type TokenConsumption = {
  tokenId: string;
  accountId: string;
  tokenHash: string;
  now: Date;
};

export type SessionCreation = {
  id: string;
  accountId: string;
  tokenHash: string;
  expectedCredentialVersion: number;
  expectedPasswordHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
};

export type ResolvedAuthSession = {
  accountId: string;
  email: string;
};

export type PasswordResetRequest = ActionTokenIssue & {
  emailKey: string;
  now: Date;
};

export type PasswordResetConsumption = TokenConsumption & {
  passwordHash: string;
};

export type EmailJobClaim = {
  now: Date;
  limit: number;
  leaseSeconds: number;
};

export type ClaimedEmailJob = {
  id: string;
  kind: AuthTokenPurpose;
  email: string;
  idempotencyKey: string;
  attemptCount: number;
  leasedUntil: Date;
  token: ActionTokenMetadata;
};

export type EmailJobCompletion = {
  id: string;
  leasedUntil: Date;
  now: Date;
};

export type EmailJobRetry = EmailJobCompletion & {
  availableAt: Date;
  lastErrorCode: string;
};

export type AuthCleanupRequest = { now: Date; limit: number };

export type AuthCleanupResult = {
  rateLimits: number;
  tokens: number;
  sessions: number;
  emailJobs: number;
};
