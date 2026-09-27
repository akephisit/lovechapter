// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignUpForm } from "./sign-up-form";
import { UiLanguageProvider } from "./ui-language-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("SignUpForm", () => {
  it("is accessible and preserves email/password input exactly", async () => {
    const submit = vi.fn(async () => ({ accepted: true as const }));
    render(<SignUpForm submit={submit} />);
    const user = userEvent.setup();

    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.type(screen.getByLabelText("Display name"), "Mali & Arun");
    await user.type(
      screen.getByLabelText("Email address"),
      " Couple@Example.test ",
    );
    const exactUnicodePassword = "  รักกันตลอดไป  ";
    await user.type(screen.getByLabelText("Password"), exactUnicodePassword);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(submit).toHaveBeenCalledWith({
      displayName: "Mali & Arun",
      email: " Couple@Example.test ",
      password: exactUnicodePassword,
    });
    expect(await screen.findByText("Check your email")).toBeVisible();
  });

  it("validates password length by Unicode code points", async () => {
    const submit = vi.fn();
    render(<SignUpForm submit={submit} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Display name"), "Couple");
    await user.type(screen.getByLabelText("Email address"), "c@example.test");
    await user.type(screen.getByLabelText("Password"), "สั้นเกิน");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("alert")).toHaveTextContent("12–128");
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps registration guidance and validation in Thai", async () => {
    render(
      <UiLanguageProvider language="th">
        <SignUpForm submit={vi.fn()} />
      </UiLanguageProvider>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "สร้างบัญชี" })).toBeVisible();
    await user.type(screen.getByLabelText("ชื่อที่แสดง"), "มะลิ");
    await user.type(screen.getByLabelText("อีเมล"), "m@example.test");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "short");
    await user.click(screen.getByRole("button", { name: "สร้างบัญชี" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "รหัสผ่านต้องมี 12–128 อักขระยูนิโค้ด",
    );
  });
});
