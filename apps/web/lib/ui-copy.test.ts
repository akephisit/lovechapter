import { describe, expect, it } from "vitest";

import { getUiCopy } from "./ui-copy";

function shape(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shape(item)]),
    );
  }
  return typeof value;
}

describe("UI copy", () => {
  it("provides English fallback and Thai equivalents", () => {
    expect(getUiCopy("en").common.signIn).toBe("Sign in");
    expect(getUiCopy("th").common.signIn).toBe("เข้าสู่ระบบ");
    expect(getUiCopy("en").errors.unexpected).toBe(
      "Something went wrong. Please try again.",
    );
    expect(getUiCopy("th").common.itemCount(2)).toBe("2 รายการ");
  });

  it("has matching keys and parameterized value shapes", () => {
    expect(shape(getUiCopy("th"))).toEqual(shape(getUiCopy("en")));
    expect(getUiCopy("en").common.itemCount(2)).toBe("2 items");
  });
});
