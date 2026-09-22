export type AuthErrorCode =
  "invalid_credentials" | "invalid_request" | "invalid_token";

export class AuthServiceError extends Error {
  override readonly name = "AuthServiceError";

  constructor(
    readonly code: AuthErrorCode,
    readonly status: 400 | 401,
    message: string,
  ) {
    super(message);
  }
}

export function invalidCredentials(): AuthServiceError {
  return new AuthServiceError(
    "invalid_credentials",
    401,
    "Invalid email or password",
  );
}

export function invalidToken(): AuthServiceError {
  return new AuthServiceError("invalid_token", 400, "Invalid or expired token");
}

export function invalidRequest(message = "Invalid request"): AuthServiceError {
  return new AuthServiceError("invalid_request", 400, message);
}
