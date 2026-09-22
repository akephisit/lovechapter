"use client";

import type {
  AuthenticatedUser,
  AuthSessionResponse,
} from "@lovechapter/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, createLoveChapterApi } from "../lib/api-client";

export type AuthSessionState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "error"; user: null };

export type AuthSessionContextValue = AuthSessionState & {
  refresh(): Promise<void>;
  signOut(): Promise<void>;
};

export type AuthSessionApi = {
  getSession(): Promise<AuthSessionResponse>;
  signOut(): Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({
  children,
  api: providedApi,
}: {
  children: ReactNode;
  api?: AuthSessionApi;
}) {
  const [state, setState] = useState<AuthSessionState>({
    status: "loading",
    user: null,
  });
  const inFlight = useRef<Promise<void> | null>(null);
  const defaultApi = useMemo<AuthSessionApi>(() => {
    const client = createLoveChapterApi(() => {
      setState({ status: "anonymous", user: null });
    });
    return { getSession: client.getSession, signOut: client.signOut };
  }, []);
  const api = providedApi ?? defaultApi;

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    setState({ status: "loading", user: null });
    const attempt = api
      .getSession()
      .then(({ user }) => {
        setState({ status: "authenticated", user });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: "anonymous", user: null });
          return;
        }
        setState({ status: "error", user: null });
      })
      .finally(() => {
        if (inFlight.current === attempt) inFlight.current = null;
      });
    inFlight.current = attempt;
    return attempt;
  }, [api]);

  const signOut = useCallback(async () => {
    setState({ status: "anonymous", user: null });
    await api.signOut();
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({ ...state, refresh, signOut }),
    [refresh, signOut, state],
  );
  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider");
  }
  return value;
}
