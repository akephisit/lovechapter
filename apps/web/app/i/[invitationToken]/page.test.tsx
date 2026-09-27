import { describe, expect, it, vi } from "vitest";

import { generateMetadata } from "./page";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "th" }) }),
  headers: async () => new Headers({ "accept-language": "en-US" }),
}));

describe("private invitation metadata", () => {
  it("localizes the title without indexing invitation pages", async () => {
    expect(await generateMetadata()).toMatchObject({
      title: "คำเชิญส่วนตัว",
      robots: { index: false, follow: false, nocache: true },
    });
  });
});
