// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../components/auth-session-provider";
import { ApiError } from "../../lib/api-client";
import WorkspacePage from "./page";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

describe("workspace session boundary", () => {
  it("redirects anonymous visitors to sign in without rendering workspace data", async () => {
    render(
      <AuthSessionProvider
        api={{
          getSession: async () => {
            throw new ApiError("Authentication required", 401);
          },
          signOut: async () => undefined,
        }}
      >
        <WorkspacePage />
      </AuthSessionProvider>,
    );

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/sign-in"),
    );
    expect(screen.queryByText(/plan the chapter/i)).not.toBeInTheDocument();
  });

  it("keeps a transient session outage retryable", async () => {
    const getSession = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("Unavailable", 503))
      .mockRejectedValueOnce(new ApiError("Unavailable", 503));
    render(
      <AuthSessionProvider api={{ getSession, signOut: async () => undefined }}>
        <WorkspacePage />
      </AuthSessionProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: /couldn't restore your session/i,
      }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(navigation.replace).not.toHaveBeenCalledWith("/sign-in");
  });
});
