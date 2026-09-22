// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "./forgot-password-form";

describe("ForgotPasswordForm", () => {
  it("shows the same generic response for every accepted address", async () => {
    const submit = vi.fn(async () => ({ accepted: true as const }));
    render(<ForgotPasswordForm submit={submit} />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Email address"),
      "Missing@Example.test",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(submit).toHaveBeenCalledWith({ email: "Missing@Example.test" });
    expect(await screen.findByText("Check your email")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "If an eligible account exists",
    );
  });
});
