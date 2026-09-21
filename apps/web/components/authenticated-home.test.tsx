// @vitest-environment jsdom

import type {
  AuthenticatedUser,
  Page,
  WeddingSummary,
} from "@lovechapter/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticatedHome,
  type AuthenticatedSession,
} from "./authenticated-home";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthenticatedHome", () => {
  it("waits for Clerk before loading the profile", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthenticatedHome
        session={sessionFixture({ isLoaded: false, isSignedIn: false })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    expect(screen.getByText("Checking your session…")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the supplied signed-out state without loading protected data", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthenticatedHome
        session={sessionFixture({ isSignedIn: false })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    expect(screen.getByText("Sign-in redirect")).toBeVisible();
    expect(screen.queryByText(/plan the chapter/i)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes a Unicode profile before rendering the workspace", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/me" && init?.method === "PATCH") {
        return jsonResponse(userFixture("มะลิ & Arun", true));
      }
      if (url.pathname === "/v1/me") {
        return jsonResponse(userFixture("", false));
      }
      if (url.pathname === "/v1/weddings") return jsonResponse(page([]));
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthenticatedHome
        session={sessionFixture({ suggestedDisplayName: "คู่รัก" })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    const input = await screen.findByRole("textbox", { name: /display name/i });
    expect(input).toHaveValue("คู่รัก");
    await user.clear(input);
    await user.type(input, "  มะลิ & Arun  ");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("มะลิ & Arun")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCall?.[1]?.body).toBe(
      JSON.stringify({ displayName: "มะลิ & Arun" }),
    );
  });

  it("renders the workspace for a completed profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/me") return jsonResponse(userFixture());
        if (url.pathname === "/v1/weddings") return jsonResponse(page([]));
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    render(
      <AuthenticatedHome
        session={sessionFixture()}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    expect(screen.getByText("Couple one")).toBeVisible();
  });

  it("signs out and leaves no protected content after an initial 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              code: "authentication_required",
              message: "Authentication required",
            },
          },
          401,
        ),
      ),
    );
    const signOut = vi.fn(async () => undefined);

    render(
      <AuthenticatedHome
        session={sessionFixture({ signOut })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    expect(await screen.findByText(/signing you out/i)).toBeVisible();
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText("Mali & Arun")).not.toBeInTheDocument();
  });

  it("clears an open workspace when a later protected request returns 401", async () => {
    const wedding = weddingFixture();
    let guestReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/me") return jsonResponse(userFixture());
        if (url.pathname === "/v1/weddings") {
          return jsonResponse(page([wedding]));
        }
        if (url.pathname.endsWith("/guests")) {
          guestReads += 1;
          if (guestReads === 1) return jsonResponse(page([]));
          return jsonResponse(
            {
              error: {
                code: "authentication_required",
                message: "Authentication required",
              },
            },
            401,
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const signOut = vi.fn(async () => undefined);
    const user = userEvent.setup();

    render(
      <AuthenticatedHome
        session={sessionFixture({ signOut })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: wedding.name }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /refresh responses/i }),
    );

    expect(await screen.findByText(/signing you out/i)).toBeVisible();
    expect(screen.queryByText(wedding.name)).not.toBeInTheDocument();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("retries a transient initial profile error", async () => {
    let profileReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/me") {
          profileReads += 1;
          return profileReads === 1
            ? jsonResponse({ error: { message: "Unavailable" } }, 500)
            : jsonResponse(userFixture());
        }
        if (url.pathname === "/v1/weddings") return jsonResponse(page([]));
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const user = userEvent.setup();

    render(
      <AuthenticatedHome
        session={sessionFixture()}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /try again/i }));

    expect(
      await screen.findByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    expect(profileReads).toBe(2);
  });

  it("offers a safe retry when Clerk sign-out fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              code: "authentication_required",
              message: "Authentication required",
            },
          },
          401,
        ),
      ),
    );
    const signOut = vi
      .fn<AuthenticatedSession["signOut"]>()
      .mockRejectedValueOnce(new Error("Clerk unavailable"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <AuthenticatedHome
        session={sessionFixture({ signOut })}
        signedOutFallback={<p>Sign-in redirect</p>}
      />,
    );

    const retry = await screen.findByRole("button", {
      name: /try signing out again/i,
    });
    expect(screen.queryByText("Mali & Arun")).not.toBeInTheDocument();
    await user.click(retry);

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/signing you out/i)).toBeVisible();
  });
});

function sessionFixture(
  overrides: Partial<AuthenticatedSession> = {},
): AuthenticatedSession {
  return {
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => "session-token",
    suggestedDisplayName: "Couple one",
    signOut: async () => undefined,
    ...overrides,
  };
}

function userFixture(
  displayName = "Couple one",
  onboardingComplete = true,
): AuthenticatedUser {
  return {
    id: "018f0000-0000-7000-8000-000000000000",
    displayName,
    email: "one@example.test",
    onboardingComplete,
  };
}

function weddingFixture(): WeddingSummary {
  return {
    id: "018f0000-0000-7000-8000-000000000001",
    name: "Mali & Arun",
    weddingDate: "2027-02-14",
    timeZone: "Asia/Bangkok",
    locale: "en",
    role: "owner",
    createdAt: "2026-09-21T10:00:00.000Z",
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
