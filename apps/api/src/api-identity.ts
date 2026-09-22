import {
  createConfiguredIdentityProvider,
  type IdentityEnvironment,
  type IdentityProvider,
} from "@lovechapter/domain";

import {
  createLocalIdentityProvider,
  type SessionResolver,
} from "./local-identity";
import type { CookieEnvironment } from "./session-cookie";

export type ApiIdentityEnvironment = IdentityEnvironment & {
  AUTH_MODE?: "disabled" | "development" | "local";
};

export type LocalIdentityDependencies = {
  authService: SessionResolver;
  nodeEnvironment: CookieEnvironment;
};

export function createApiIdentityProvider(
  environment: IdentityEnvironment,
  local?: LocalIdentityDependencies,
): IdentityProvider {
  if (environment.AUTH_MODE === "local") {
    return local
      ? createLocalIdentityProvider(local.authService, local.nodeEnvironment)
      : createConfiguredIdentityProvider({ AUTH_MODE: "disabled" });
  }
  return createConfiguredIdentityProvider(environment);
}
