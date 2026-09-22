export class DomainValidationError extends Error {
  override readonly name = "DomainValidationError";
}

export class AuthenticationRequiredError extends Error {
  override readonly name = "AuthenticationRequiredError";
}

export class OnboardingRequiredError extends Error {
  override readonly name = "OnboardingRequiredError";
}

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}

export class RateLimitExceededError extends Error {
  override readonly name = "RateLimitExceededError";
  readonly code = "rate_limited";
  readonly status = 429;
}
