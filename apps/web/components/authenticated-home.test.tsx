// @vitest-environment jsdom

import type { AuthenticatedUser, Page } from "@lovechapter/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthSessionProvider,
  type AuthSessionApi,
} from "./auth-session-provider";
import { AuthenticatedHome } from "./authenticated-home";

afterEach(() => vi.unstubAllGlobals());

describe("AuthenticatedHome", () => {
  it("renders the workspace from restored first-party session state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (proxiedApiPath(input) === "/v1/weddings") {
          return jsonResponse(page([]));
        }
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );
    renderHome(sessionApi(userFixture()));

    expect(
      await screen.findByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    expect(screen.getByText("Couple one")).toBeVisible();
  });

  it("completes profile onboarding without a bearer token", async () => {
    const completeUser = userFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = proxiedApiPath(input);
        if (path === "/v1/me" && init?.method === "PATCH") {
          return jsonResponse(completeUser);
        }
        if (path === "/v1/weddings") return jsonResponse(page([]));
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const getSession = vi
      .fn<AuthSessionApi["getSession"]>()
      .mockResolvedValueOnce({
        user: userFixture("", false),
      })
      .mockResolvedValue({ user: completeUser });
    renderHome(sessionApi(undefined, { getSession }));
    const user = userEvent.setup();

    const input = await screen.findByRole("textbox", { name: /display name/i });
    await user.type(input, "คู่รัก");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("clears rendered workspace state when signing out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse(page([]))),
    );
    const signOut = vi.fn(async () => undefined);
    renderHome(sessionApi(userFixture(), { signOut }));
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: /plan the chapter/i });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: /plan the chapter/i }),
    ).not.toBeInTheDocument();
  });
});

function renderHome(api: AuthSessionApi) {
  return render(
    <AuthSessionProvider api={api}>
      <AuthenticatedHome />
    </AuthSessionProvider>,
  );
}

function sessionApi(
  user = userFixture(),
  overrides: Partial<AuthSessionApi> = {},
): AuthSessionApi {
  return {
    getSession: async () => ({ user }),
    signOut: async () => undefined,
    ...overrides,
  };
}

function userFixture(
  displayName = "Couple one",
  onboardingComplete = true,
): AuthenticatedUser {
  return {
    id: "018f0000-0000-4000-8000-000000000000",
    displayName,
    email: "one@example.test",
    onboardingComplete,
  };
}

function page<T>(items: T[]): Page<T> {
  return { items, nextCursor: null };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function proxiedApiPath(input: RequestInfo | URL): string {
  return new URL(String(input), "https://web.example.test").pathname.replace(
    /^\/api/,
    "",
  );
}
