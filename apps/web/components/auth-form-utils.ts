import { ApiError, createLoveChapterApi } from "../lib/api-client";
import type { UiCopy } from "../lib/ui-copy";

export function createAnonymousApi() {
  return createLoveChapterApi(() => undefined);
}

export function authErrorMessage(
  error: unknown,
  copy: UiCopy,
  fallbackKey: keyof UiCopy["errors"],
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
  return copy.errors[fallbackKey];
}

export function passwordLengthError(
  password: string,
  copy: UiCopy,
): string | null {
  const length = [...password].length;
  return length < 12 || length > 128 ? copy.errors.passwordLength : null;
}

export function readAndScrubFragmentToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return token || null;
}
