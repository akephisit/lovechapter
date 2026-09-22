// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthErrorBoundary } from "./auth-error-boundary";

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
});
