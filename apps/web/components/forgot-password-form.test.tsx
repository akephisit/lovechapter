// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "./forgot-password-form";
import { UiLanguageProvider } from "./ui-language-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  it("keeps the non-disclosing reset response in Thai", async () => {
    render(
      <UiLanguageProvider language="th">
        <ForgotPasswordForm submit={async () => ({ accepted: true })} />
      </UiLanguageProvider>,
    );
    await userEvent.type(
      screen.getByLabelText("อีเมล"),
      "missing@example.test",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "หากมีบัญชีที่เข้าเงื่อนไข",
    );
  });
});
