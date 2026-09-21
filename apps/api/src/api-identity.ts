import {
  createConfiguredIdentityProvider,
  type IdentityEnvironment,
  type IdentityProvider,
} from "@lovechapter/domain";

import {
  createClerkIdentityProvider,
  type AuthenticateClerkSession,
} from "./clerk-identity";

export type ApiIdentityEnvironment = IdentityEnvironment & {
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_JWT_KEY?: string;
  PUBLIC_WEB_ORIGIN?: string;
};

export function createApiIdentityProvider(
  environment: ApiIdentityEnvironment,
  authenticate?: AuthenticateClerkSession,
): IdentityProvider {
  if (environment.AUTH_MODE === "clerk") {
    const publicWebOrigin = parsePublicWebOrigin(environment.PUBLIC_WEB_ORIGIN);
    return createClerkIdentityProvider(
      {
        publishableKey: required(
          environment.CLERK_PUBLISHABLE_KEY,
          "CLERK_PUBLISHABLE_KEY",
        ),
        jwtKey: required(environment.CLERK_JWT_KEY, "CLERK_JWT_KEY"),
        publicWebOrigin,
      },
      authenticate,
    );
  }
  return createConfiguredIdentityProvider(environment);
}

export function parsePublicWebOrigin(value: string | undefined): string {
  const configured = required(value, "PUBLIC_WEB_ORIGIN");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw originError();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw originError();
  }
  return url.origin;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function originError(): Error {
  return new Error("PUBLIC_WEB_ORIGIN must be an absolute HTTP(S) origin");
}
