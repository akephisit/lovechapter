"use client";

import { useMemo } from "react";

import { createLoveChapterApi } from "../lib/api-client";
import { useAuthSession } from "./auth-session-provider";
import { CoupleWorkspace } from "./couple-workspace";
import { ProfileOnboarding } from "./profile-onboarding";

export function AuthenticatedHome() {
  const session = useAuthSession();
  const api = useMemo(
    () => createLoveChapterApi(session.refresh),
    [session.refresh],
  );

  if (session.status !== "authenticated") return null;
  if (!session.user.onboardingComplete) {
    return (
      <ProfileOnboarding
        suggestedDisplayName={session.user.displayName}
        api={api}
        onComplete={() => void session.refresh()}
      />
    );
  }
  return (
    <CoupleWorkspace
      identity={session.user}
      api={api}
      onSignOut={() => void session.signOut()}
    />
  );
}
