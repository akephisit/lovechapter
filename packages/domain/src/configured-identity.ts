import type { IdentityProvider } from "./identity";

export type IdentityEnvironment = {
  AUTH_MODE?: string;
  DEV_AUTH_SUBJECT?: string;
  DEV_AUTH_DISPLAY_NAME?: string;
  DEV_AUTH_EMAIL?: string;
};

export function createConfiguredIdentityProvider(
  environment: IdentityEnvironment,
): IdentityProvider {
  return {
    resolve: async () => {
      if (environment.AUTH_MODE !== "development") return null;
      const subject = environment.DEV_AUTH_SUBJECT?.trim();
      const displayName = environment.DEV_AUTH_DISPLAY_NAME?.trim();
      if (!subject || !displayName) return null;
      const email = environment.DEV_AUTH_EMAIL?.trim().toLowerCase();
      return email
        ? { provider: "development", subject, displayName, email }
        : { provider: "development", subject, displayName };
    },
  };
}
