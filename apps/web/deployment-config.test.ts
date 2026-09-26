import { readdir, readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("web Worker deployment", () => {
  it("has a resolvable server entry for application routes", async () => {
    const config = await readFile(
      new URL("./wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const entry = config.match(/^\s*"main"\s*:\s*"([^"]+)"/m)?.[1];

    expect(entry).toBeDefined();
    const resolved = import.meta.resolve(entry!);
    expect((await stat(new URL(resolved))).isFile()).toBe(true);
  });

  it("does not publish test source as static assets", async () => {
    const files = await readdir(new URL("./public/", import.meta.url), {
      recursive: true,
    });

    expect(files.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file))).toEqual(
      [],
    );
  });
});
