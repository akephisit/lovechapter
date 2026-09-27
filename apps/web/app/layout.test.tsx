import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import RootLayout, { generateMetadata } from "./layout";

const request = vi.hoisted(() => ({
  cookie: "th",
  acceptLanguage: "en-US",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookie ? { value: request.cookie } : undefined),
  }),
  headers: async () =>
    new Headers({
      "accept-language": request.acceptLanguage,
      "x-lovechapter-published-sha": "a".repeat(40),
    }),
}));

describe("root UI language", () => {
  it("uses the Thai preference for html lang and metadata", async () => {
    const element = await RootLayout({ children: "page" as ReactNode });
    expect(element.props.lang).toBe("th");
    const metadata = await generateMetadata();
    expect(metadata.title).toMatchObject({
      default: "LoveChapter — วางแผนงานแต่งและตอบรับคำเชิญ",
    });
    expect(metadata.description).toContain("พื้นที่วางแผนงานแต่ง");
  });
});
