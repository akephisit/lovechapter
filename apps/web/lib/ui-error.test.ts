import { describe, expect, it } from "vitest";

import { ApiError } from "./api-client";
import { getUiCopy } from "./ui-copy";
import { safeUiError } from "./ui-error";

describe("safeUiError", () => {
  it("maps known validation codes and hides unknown backend text", () => {
    const copy = getUiCopy("th");
    expect(
      safeUiError(
        new ApiError("raw English", 400, "validation_error"),
        copy,
        copy.planning.saveError,
      ),
    ).toBe(copy.errors.invalidInput);
    expect(
      safeUiError(
        new ApiError("raw English", 500, "unknown"),
        copy,
        copy.planning.saveError,
      ),
    ).toBe(copy.planning.saveError);
  });
});
