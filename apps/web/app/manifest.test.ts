import { describe, expect, it, vi } from "vitest";
import manifest from "./manifest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "th" }) }),
  headers: async () => new Headers({ "accept-language": "en-US" }),
}));

describe("web manifest", () => {
  it("uses Thai descriptive copy with the Thai preference", async () => {
    const result = await manifest();
    expect(result.name).toBe("LoveChapter");
    expect(result.description).toContain("พื้นที่วางแผนงานแต่ง");
  });
});
