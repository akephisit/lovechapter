import { ApiError, createLoveChapterApi } from "../lib/api-client";

export function createAnonymousApi() {
  return createLoveChapterApi(() => undefined);
}

export function authErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function passwordLengthError(password: string): string | null {
  const length = [...password].length;
  return length < 12 || length > 128
    ? "Password must contain 12–128 Unicode characters."
    : null;
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
