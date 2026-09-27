// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthErrorBoundary } from "./auth-error-boundary";
import { UiLanguageProvider } from "./ui-language-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthErrorBoundary", () => {
  it("shows an English fallback and remounts its child on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;

    function Child() {
      if (shouldThrow) throw new Error("Session provider failed");
      return <p>Session restored</p>;
    }

    const user = userEvent.setup();
    render(
      <AuthErrorBoundary>
        <Child />
      </AuthErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't open your private workspace/i,
    );
    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByText("Session restored")).toBeVisible();
  });

  it("offers a Thai fallback and language switch when account rendering fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): ReactNode {
      throw new Error("failed");
    }
    render(
      <UiLanguageProvider language="th">
        <AuthErrorBoundary>
          <Broken />
        </AuthErrorBoundary>
      </UiLanguageProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ไม่สามารถเปิดพื้นที่ส่วนตัวของคุณได้",
    );
    expect(screen.getByRole("combobox", { name: "ภาษา" })).toBeVisible();
  });
});
