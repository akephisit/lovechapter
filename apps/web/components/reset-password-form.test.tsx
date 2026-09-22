// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { ResetPasswordForm } from "./reset-password-form";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ResetPasswordForm", () => {
  it("scrubs the fragment and submits the exact Unicode password", async () => {
    window.history.replaceState(null, "", "/reset-password#token=reset-secret");
    const historyReplaceState = vi.spyOn(window.history, "replaceState");
    const clientFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ reset: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", clientFetch);
    render(<ResetPasswordForm />);
    const user = userEvent.setup();
    const exactUnicodePassword = "  รักกันตลอดไป  ";

    await waitFor(() =>
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        "/reset-password",
      ),
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.type(
      screen.getByLabelText("New password"),
      exactUnicodePassword,
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    const [requestUrl, init] = clientFetch.mock.calls[0] ?? [];
    expect(requestUrl).toBe("/api/v1/auth/reset-password");
    expect(String(requestUrl)).not.toContain("reset-secret");
    expect(String(requestUrl)).not.toContain("#");
    expect(JSON.parse(String(init?.body))).toEqual({
      token: "reset-secret",
      password: exactUnicodePassword,
    });
    expect(await screen.findByText("Password reset")).toBeVisible();
  });

  it("shows invalid or expired token feedback", async () => {
    window.history.replaceState(null, "", "/reset-password#token=expired");
    render(
      <ResetPasswordForm
        submit={async () => {
          throw new ApiError("Invalid or expired token", 400, "invalid_token");
        }}
      />,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("New password"),
      "replacement password",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid or expired token",
    );
  });
});
