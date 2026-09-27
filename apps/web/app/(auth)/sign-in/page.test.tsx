import { describe, expect, it, vi } from "vitest";

import { generateMetadata } from "./page";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "th" }) }),
  headers: async () => new Headers({ "accept-language": "en-US" }),
}));

describe("sign-in metadata", () => {
  it("uses the selected UI language", async () => {
    expect(await generateMetadata()).toMatchObject({ title: "เข้าสู่ระบบ" });
  });
});
