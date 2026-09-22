// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { VerifyEmailForm } from "./verify-email-form";

describe("VerifyEmailForm", () => {
  it("scrubs the fragment before verifying its token", async () => {
    window.history.replaceState(null, "", "/verify-email#token=verify-secret");
    const historyReplaceState = vi.spyOn(window.history, "replaceState");
    const verify = vi.fn(async () => ({ verified: true as const }));

    render(<VerifyEmailForm verify={verify} />);

    await waitFor(() =>
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        "/verify-email",
      ),
    );
    expect(verify).toHaveBeenCalledWith({ token: "verify-secret" });
    expect(await screen.findByText("Email verified")).toBeVisible();
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
