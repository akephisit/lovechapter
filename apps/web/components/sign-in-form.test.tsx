// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { UiLanguageProvider } from "./ui-language-provider";
import { SignInForm } from "./sign-in-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("SignInForm", () => {
  it("relocalizes an existing sign-in error without resetting entered fields", async () => {
    const submit = vi.fn(async () => {
      throw new ApiError("wrong", 401, "invalid_credentials");
    });
    const { rerender } = render(
      <UiLanguageProvider language="en">
        <SignInForm submit={submit} onSignedIn={vi.fn()} />
      </UiLanguageProvider>,
    );
    await userEvent.type(
      screen.getByLabelText("Email address"),
      "c@example.test",
    );
    await userEvent.type(
      screen.getByLabelText("Password"),
      "wrong password phrase",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
    rerender(
      <UiLanguageProvider language="th">
        <SignInForm submit={submit} onSignedIn={vi.fn()} />
      </UiLanguageProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    );
    expect(screen.getByLabelText("อีเมล")).toHaveValue("c@example.test");
  });
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

  it("renders Thai controls and never shows an unknown backend message", async () => {
    const submit = vi.fn(async () => {
      throw new ApiError("raw English internal detail", 500, "unknown_code");
    });
    render(
      <UiLanguageProvider language="th">
        <SignInForm submit={submit} onSignedIn={vi.fn()} />
      </UiLanguageProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("อีเมล"), "c@example.test");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "wrong password phrase");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง",
    );
    expect(screen.queryByText(/raw English/)).not.toBeInTheDocument();
  });
});
