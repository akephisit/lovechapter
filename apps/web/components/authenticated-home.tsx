"use client";

import type { AuthenticatedUser } from "@lovechapter/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  createLoveChapterApi,
  type TokenProvider,
} from "../lib/api-client";
import { CoupleWorkspace } from "./couple-workspace";
import { ProfileOnboarding } from "./profile-onboarding";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export type AuthenticatedSession = {
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: TokenProvider;
  suggestedDisplayName: string;
  signOut(): Promise<void>;
};

type Props = {
  session: AuthenticatedSession;
  signedOutFallback: ReactNode;
};

type ViewState = "loading" | "ready" | "error" | "signing-out";

export function AuthenticatedHome({ session, signedOutFallback }: Props) {
  const { isLoaded, isSignedIn, getToken, signOut, suggestedDisplayName } =
    session;
  const [identity, setIdentity] = useState<AuthenticatedUser | null>(null);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [retryRevision, setRetryRevision] = useState(0);
  const requestGeneration = useRef(0);
  const signOutStarted = useRef(false);

  const handleAuthenticationRequired = useCallback(async () => {
    setIdentity(null);
    setViewState("signing-out");
    if (signOutStarted.current) return;
    signOutStarted.current = true;
    await signOut();
  }, [signOut]);

  const api = useMemo(
    () => createLoveChapterApi(getToken, handleAuthenticationRequired),
    [getToken, handleAuthenticationRequired],
  );

  useEffect(() => {
    const generation = ++requestGeneration.current;

    if (!isLoaded) {
      setIdentity(null);
      setViewState("loading");
      return;
    }
    if (!isSignedIn) {
      setIdentity(null);
      return;
    }

    setViewState("loading");
    void api
      .getMe()
      .then((user) => {
        if (requestGeneration.current !== generation) return;
        setIdentity(user);
        setViewState("ready");
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return;
        if (error instanceof ApiError && error.status === 401) return;
        setIdentity(null);
        setViewState("error");
      });

    return () => {
      if (requestGeneration.current === generation) {
        requestGeneration.current += 1;
      }
    };
  }, [api, isLoaded, isSignedIn, retryRevision]);

  if (!isLoaded) return <SessionMessage>Checking your session…</SessionMessage>;
  if (!isSignedIn) return signedOutFallback;
  if (viewState === "signing-out") {
    return <SessionMessage>Signing you out…</SessionMessage>;
  }
  if (viewState === "error") {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-10">
        <Card className="w-full max-w-lg p-8 text-center">
          <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
            We couldn't load your profile.
          </h1>
          <p className="mt-3 leading-7 text-[#725f62]">
            Your session is still active. Please try the request again.
          </p>
          <Button
            className="mt-6"
            onClick={() => setRetryRevision((current) => current + 1)}
          >
            Try again
          </Button>
        </Card>
      </main>
    );
  }
  if (viewState !== "ready" || !identity) {
    return <SessionMessage>Checking your session…</SessionMessage>;
  }
  if (!identity.onboardingComplete) {
    return (
      <ProfileOnboarding
        suggestedDisplayName={suggestedDisplayName}
        api={api}
        onComplete={(user) => setIdentity(user)}
      />
    );
  }

  return (
    <CoupleWorkspace
      identity={identity}
      api={api}
      onSignOut={() => void handleAuthenticationRequired()}
    />
  );
}

function SessionMessage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <p className="text-sm font-semibold text-[#725f62]" aria-live="polite">
        {children}
      </p>
    </main>
  );
}
