import { describe, expect, it } from "vitest";

import { resolveUiLanguage, UI_LANGUAGE_COOKIE } from "./ui-language";

describe("resolveUiLanguage", () => {
  it("cookie wins over browser language", () => {
    expect(UI_LANGUAGE_COOKIE).toBe("lc_ui_language");
    expect(resolveUiLanguage("th", "en-US,en;q=0.9")).toBe("th");
  });

  it("weighted Thai wins over English when the cookie is invalid", () => {
    expect(resolveUiLanguage("xx", "th-TH;q=0.9,en-US;q=0.2")).toBe("th");
  });

  it("rejects q=0 and malformed preferences", () => {
    expect(resolveUiLanguage(null, "th;q=0,en;q=0.4")).toBe("en");
    expect(resolveUiLanguage(null, "th;q=1.5,en;q=0.4")).toBe("en");
    expect(resolveUiLanguage(null, "th;q=nope,en;q=0.4")).toBe("en");
  });

  it("uses English when no supported language is acceptable", () => {
    expect(resolveUiLanguage(null, "fr-FR")).toBe("en");
    expect(resolveUiLanguage(null, "*")).toBe("en");
    expect(resolveUiLanguage(null, null)).toBe("en");
  });

  it("breaks an equal preference in favor of English", () => {
    expect(resolveUiLanguage(null, "th;q=0.8,en;q=0.8")).toBe("en");
    expect(resolveUiLanguage(null, "EN-gb")).toBe("en");
  });
});
