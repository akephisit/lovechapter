// @vitest-environment jsdom

import type { AuthenticatedUser } from "@lovechapter/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import {
  AuthSessionProvider,
  useAuthSession,
  type AuthSessionApi,
} from "./auth-session-provider";

const user: AuthenticatedUser = {
  id: "018f0000-0000-4000-8000-000000000001",
  displayName: "Mali & Arun",
  email: "couple@example.test",
  onboardingComplete: true,
};

describe("AuthSessionProvider", () => {
  it("restores an authenticated cookie session", async () => {
    const api = apiFixture({ getSession: async () => ({ user }) });
    renderSession(api);

    expect(screen.getByText("loading")).toBeVisible();
    expect(await screen.findByText("authenticated:Mali & Arun")).toBeVisible();
  });

  it("deduplicates in-flight session restoration", async () => {
    let resolve!: (value: { user: AuthenticatedUser }) => void;
    const getSession = vi.fn(
      () =>
        new Promise<{ user: AuthenticatedUser }>((done) => {
          resolve = done;
        }),
    );
    renderSession(apiFixture({ getSession }));
    const retry = await screen.findByRole("button", { name: "Refresh" });

    await Promise.all([retry.click(), retry.click()]);
    expect(getSession).toHaveBeenCalledOnce();
    resolve({ user });
    expect(await screen.findByText("authenticated:Mali & Arun")).toBeVisible();
  });

  it("clears expired sessions but keeps transient outages retryable", async () => {
    const expired = apiFixture({
      getSession: async () => {
        throw new ApiError(
          "Authentication required",
          401,
          "authentication_required",
        );
      },
    });
    const first = renderSession(expired);
    expect(await screen.findByText("anonymous")).toBeVisible();
    first.unmount();

    const getSession = vi
      .fn<AuthSessionApi["getSession"]>()
      .mockRejectedValueOnce(new ApiError("Unavailable", 503))
      .mockResolvedValueOnce({ user });
    renderSession(apiFixture({ getSession }));
    expect(await screen.findByText("error")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("authenticated:Mali & Arun")).toBeVisible();
  });

  it("clears protected session state after sign-out", async () => {
    const signOut = vi.fn(async () => undefined);
    renderSession(apiFixture({ getSession: async () => ({ user }), signOut }));
    expect(await screen.findByText("authenticated:Mali & Arun")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(screen.getByText("anonymous")).toBeVisible();
  });
});

function renderSession(api: AuthSessionApi) {
  return render(
    <AuthSessionProvider api={api}>
      <SessionProbe />
    </AuthSessionProvider>,
  );
}

function SessionProbe() {
  const session = useAuthSession();
  return (
    <div>
      <span>
        {session.status}
        {session.user ? `:${session.user.displayName}` : ""}
      </span>
      <button onClick={() => void session.refresh()}>Refresh</button>
      <button onClick={() => void session.signOut()}>Sign out</button>
    </div>
  );
}

function apiFixture(overrides: Partial<AuthSessionApi> = {}): AuthSessionApi {
  return {
    getSession: async () => ({ user }),
    signOut: async () => undefined,
    ...overrides,
  };
}
