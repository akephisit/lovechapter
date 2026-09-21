import { describe, expect, it } from "vitest";

import { parseClerkPublishableKey } from "./clerk-config";

describe("Clerk publishable-key configuration", () => {
  it("accepts and trims a Clerk test or live publishable key", () => {
    expect(parseClerkPublishableKey("  pk_test_example  ")).toBe(
      "pk_test_example",
    );
    expect(parseClerkPublishableKey("pk_live_example")).toBe("pk_live_example");
  });

  it.each([undefined, "", "sk_test_secret", "clerk-key"])(
    "rejects an absent or non-publishable value: %s",
    (value) => {
      expect(() => parseClerkPublishableKey(value)).toThrow(
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key",
      );
    },
  );
});
