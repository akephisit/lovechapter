import type { AuthenticatedUser } from "@lovechapter/contracts";

export type Principal = {
  provider: string;
  subject: string;
  displayName: string;
  email?: string;
};

export interface IdentityProvider {
  resolve(request?: Request): Promise<Principal | null>;
}

export type ResolvedIdentity = {
  principal: Principal;
  user: AuthenticatedUser;
};
