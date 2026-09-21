import { describe, expect, it } from "vitest";

import { generateInvitationToken, hashInvitationToken } from "./invitations";

describe("invitation tokens", () => {
  it("generates independent 256-bit URL-safe tokens", () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("hashes tokens deterministically without returning the raw token", async () => {
    const token = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI";

    const firstHash = await hashInvitationToken(token);
    const secondHash = await hashInvitationToken(token);

    expect(firstHash).toBe(
      "76948896d1f54257aeae6ddfff136452705376ac2655569f36786e624b7ea0d1",
    );
    expect(secondHash).toBe(firstHash);
    expect(firstHash).not.toContain(token);
  });
});
