"use client";

import { RedirectToSignIn, useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

import {
  AuthenticatedHome,
  type AuthenticatedSession,
} from "../../components/authenticated-home";

export default function HomePage() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const signOutToLogin = useCallback(async () => {
    await signOut({ redirectUrl: "/sign-in" });
  }, [signOut]);
  const session = useMemo<AuthenticatedSession>(
    () => ({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      getToken,
      suggestedDisplayName:
        user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "",
      signOut: signOutToLogin,
    }),
    [getToken, isLoaded, isSignedIn, signOutToLogin, user],
  );

  return (
    <AuthenticatedHome
      session={session}
      signedOutFallback={<RedirectToSignIn />}
    />
  );
}
