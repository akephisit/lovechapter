// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { SignInForm } from "./sign-in-form";

describe("SignInForm", () => {
  it("uses password-manager semantics and redirects after sign-in", async () => {
    const submit = vi.fn(async () => ({ signedIn: true as const }));
    const onSignedIn = vi.fn(async () => undefined);
    render(<SignInForm submit={submit} onSignedIn={onSignedIn} />);
    const user = userEvent.setup();

    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await user.type(screen.getByLabelText("Email address"), "c@example.test");
    await user.type(screen.getByLabelText("Password"), "exact password phrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it("renders stable invalid-credentials feedback", async () => {
    const submit = vi.fn(async () => {
      throw new ApiError(
        "Invalid email or password",
        401,
        "invalid_credentials",
      );
    });
    render(<SignInForm submit={submit} onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "c@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong password phrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeVisible();
  });
});
