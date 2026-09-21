import { createClerkClient } from "@clerk/backend";
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

type ClerkAuthLike = {
  userId?: string | null;
  sessionClaims?: unknown;
};

type ClerkRequestStateLike = {
  toAuth(): ClerkAuthLike | null;
};

export type ClerkClientLike = {
  authenticateRequest(
    request: Request,
    options: {
      acceptsToken: "session_token";
      jwtKey: string;
      authorizedParties: string[];
    },
  ): Promise<ClerkRequestStateLike>;
};

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
  client: ClerkClientLike = createClerkClientAdapter(config.publishableKey),
): Promise<VerifiedClerkSession | null> {
  try {
    const state = await client.authenticateRequest(request, {
      acceptsToken: "session_token",
      jwtKey: config.jwtKey,
      authorizedParties: [config.publicWebOrigin],
    });
    const auth = state.toAuth();
    if (!auth?.userId || !isRecord(auth.sessionClaims)) return null;
    const primaryEmail = auth.sessionClaims.primaryEmail;
    if (typeof primaryEmail !== "string" || !primaryEmail.trim()) return null;
    return { subject: auth.userId, primaryEmail };
  } catch {
    return null;
  }
}

function createClerkClientAdapter(publishableKey: string): ClerkClientLike {
  const client = createClerkClient({ publishableKey });
  return {
    authenticateRequest: (request, options) =>
      client.authenticateRequest(request, options),
  };
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required for Clerk mode`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
