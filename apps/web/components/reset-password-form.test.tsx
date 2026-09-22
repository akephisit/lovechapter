// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { ResetPasswordForm } from "./reset-password-form";

describe("ResetPasswordForm", () => {
  it("scrubs the fragment and submits the exact Unicode password", async () => {
    window.history.replaceState(null, "", "/reset-password#token=reset-secret");
    const historyReplaceState = vi.spyOn(window.history, "replaceState");
    const resetSubmit = vi.fn(async () => ({ reset: true as const }));
    render(<ResetPasswordForm submit={resetSubmit} />);
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

    expect(resetSubmit).toHaveBeenCalledWith({
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
