// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageSwitcher } from "./language-switcher";
import { UiLanguageProvider } from "./ui-language-provider";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  navigation.refresh.mockReset();
});

describe("language switch", () => {
  it("keeps the invitation URL out of the preference request", async () => {
    window.history.replaceState(null, "", "/i/private-token");
    const send = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", send);
    render(
      <UiLanguageProvider language="en">
        <LanguageSwitcher />
      </UiLanguageProvider>,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "th",
    );
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("/ui-language");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.body).toBe(JSON.stringify({ language: "th" }));
    expect(JSON.stringify(init)).not.toContain("private-token");
    expect(window.location.pathname).toBe("/i/private-token");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
