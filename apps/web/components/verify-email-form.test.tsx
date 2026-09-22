// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { VerifyEmailForm } from "./verify-email-form";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VerifyEmailForm", () => {
  it("scrubs the fragment before verifying its token", async () => {
    window.history.replaceState(null, "", "/verify-email#token=verify-secret");
    const historyReplaceState = vi.spyOn(window.history, "replaceState");
    const clientFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", clientFetch);

    render(<VerifyEmailForm />);

    await waitFor(() =>
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        "/verify-email",
      ),
    );
    expect(await screen.findByText("Email verified")).toBeVisible();
    const [requestUrl, init] = clientFetch.mock.calls[0] ?? [];
    expect(requestUrl).toBe("/api/v1/auth/verify-email");
    expect(String(requestUrl)).not.toContain("verify-secret");
    expect(String(requestUrl)).not.toContain("#");
    expect(JSON.parse(String(init?.body))).toEqual({ token: "verify-secret" });
  });

  it("shows invalid or expired token feedback", async () => {
    window.history.replaceState(null, "", "/verify-email#token=expired");
    render(
      <VerifyEmailForm
        verify={async () => {
          throw new ApiError("Invalid or expired token", 400, "invalid_token");
        }}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid or expired token",
    );
  });
});
