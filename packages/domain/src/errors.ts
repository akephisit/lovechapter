export class DomainValidationError extends Error {
  override readonly name = "DomainValidationError";
}

export class AuthenticationRequiredError extends Error {
  override readonly name = "AuthenticationRequiredError";
}

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}
