import { describe, expect, it } from "vitest";
import { getStandardOptions } from "./standard-options";

describe("getStandardOptions", () => {
  it("provides country labels and rejects arbitrary codes", () => {
    const options = getStandardOptions("country", "en");
    expect(options.find((option) => option.value === "TH")?.label).toMatch(
      /Thailand.*TH/,
    );
    expect(options.some((option) => option.value === "ZZ")).toBe(false);
  });

  it("keeps valid stored locales outside curated suggestions", () => {
    expect(
      getStandardOptions("locale", "th", "fr-CA").some(
        (option) => option.value === "fr-CA",
      ),
    ).toBe(true);
  });

  it("labels currencies with their code", () => {
    expect(
      getStandardOptions("currency", "en").find(
        (option) => option.value === "USD",
      )?.label,
    ).toMatch(/USD/);
  });

  it("uses the wedding date for zone offsets", () => {
    const winter = getStandardOptions(
      "timeZone",
      "en",
      "America/New_York",
      "2026-01-15",
    ).find((option) => option.value === "America/New_York")?.label;
    const summer = getStandardOptions(
      "timeZone",
      "en",
      "America/New_York",
      "2026-07-15",
    ).find((option) => option.value === "America/New_York")?.label;
    expect(winter).toContain("GMT-5");
    expect(summer).toContain("GMT-4");
  });
});
