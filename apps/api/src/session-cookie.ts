export type CookieEnvironment = "development" | "test" | "production";

const PRODUCTION_COOKIE_NAME = "__Host-lovechapter_session";
const DEVELOPMENT_COOKIE_NAME = "lovechapter_dev_session";

export function sessionCookieName(environment: CookieEnvironment): string {
  return environment === "production"
    ? PRODUCTION_COOKIE_NAME
    : DEVELOPMENT_COOKIE_NAME;
}

export function serializeSessionCookie(
  token: string,
  expiresAt: Date,
  environment: CookieEnvironment,
): string {
  const secure = environment === "production" ? "; Secure" : "";
  return `${sessionCookieName(environment)}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

export function expireSessionCookie(environment: CookieEnvironment): string {
  const secure = environment === "production" ? "; Secure" : "";
  return `${sessionCookieName(environment)}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function readSessionCookie(
  request: Request,
  environment: CookieEnvironment,
): string | null {
  const name = sessionCookieName(environment);
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim() || null;
    }
  }
  return null;
}
