import type { Principal } from "@lovechapter/domain";
import type { IdentityProvider } from "@lovechapter/domain";

import { readSessionCookie, type CookieEnvironment } from "./session-cookie";

export type SessionResolver = {
  resolveSession(token: string): Promise<Principal | null>;
};

export function createLocalIdentityProvider(
  authService: SessionResolver,
  environment: CookieEnvironment,
): IdentityProvider {
  return {
    async resolve(request) {
      if (!request) return null;
      const token = readSessionCookie(request, environment);
      return token ? authService.resolveSession(token) : null;
    },
  };
}
