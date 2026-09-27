import { ApiError } from "./api-client";
import type { UiCopy } from "./ui-copy";

export function safeUiError(
  error: unknown,
  copy: UiCopy,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_credentials":
        return copy.errors.invalidCredentials;
      case "invalid_token":
        return copy.errors.invalidToken;
      case "invalid_input":
      case "validation_error":
      case "invalid_request":
        return copy.errors.invalidInput;
      case "rate_limited":
        return copy.errors.rateLimited;
    }
  }
  return fallback;
}
