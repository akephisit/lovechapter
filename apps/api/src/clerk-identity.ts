import { verifyToken } from "@clerk/backend";
import type { IdentityProvider } from "@lovechapter/domain";

export type ClerkIdentityConfig = {
  publishableKey: string;
  jwtKey: string;
  publicWebOrigin: string;
};

export type VerifiedClerkSession = {
  subject: string;
  primaryEmail: string;
};

export type AuthenticateClerkSession = (
  request: Request,
  config: ClerkIdentityConfig,
) => Promise<VerifiedClerkSession | null>;

export type VerifyClerkToken = (
  token: string,
  options: { jwtKey: string; authorizedParties: string[] },
) => Promise<unknown>;

export function createClerkIdentityProvider(
  config: ClerkIdentityConfig,
  authenticate: AuthenticateClerkSession = authenticateClerkSession,
): IdentityProvider {
  const verifiedConfig = {
    publishableKey: required(config.publishableKey, "CLERK_PUBLISHABLE_KEY"),
    jwtKey: required(config.jwtKey, "CLERK_JWT_KEY"),
    publicWebOrigin: required(config.publicWebOrigin, "PUBLIC_WEB_ORIGIN"),
  };

  return {
    resolve: async (request) => {
      if (!request) return null;
      try {
        const session = await authenticate(request, verifiedConfig);
        const subject = session?.subject.trim();
        const email = session?.primaryEmail.trim().toLowerCase();
        if (!subject || !email) return null;
        return {
          provider: "clerk",
          subject,
          displayName: email,
          email,
        };
      } catch {
        return null;
      }
    },
  };
}

export async function authenticateClerkSession(
  request: Request,
  config: ClerkIdentityConfig,
  verify: VerifyClerkToken = verifyToken,
): Promise<VerifiedClerkSession | null> {
  try {
    const token = readBearerToken(request.headers.get("authorization"));
    if (!token) return null;
    const claims = await verify(token, {
      jwtKey: config.jwtKey,
      authorizedParties: [config.publicWebOrigin],
    });
    if (
      !isRecord(claims) ||
      typeof claims.sub !== "string" ||
      typeof claims.sid !== "string" ||
      !claims.sid.trim()
    ) {
      return null;
    }
    const primaryEmail = claims.primaryEmail;
    if (typeof primaryEmail !== "string" || !primaryEmail.trim()) return null;
    return { subject: claims.sub, primaryEmail };
  } catch {
    return null;
  }
}

function readBearerToken(value: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(value ?? "");
  return match?.[1] ?? null;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required for Clerk mode`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
