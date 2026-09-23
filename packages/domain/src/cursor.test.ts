import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./cursor";
import { DomainValidationError } from "./errors";

describe("list cursors", () => {
  it("round-trips timestamp and id so tied timestamps remain deterministic", () => {
    const cursor = {
      createdAt: "2026-09-21T10:00:00.000Z",
      id: "018f0000-0000-7000-8000-000000000002",
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("preserves PostgreSQL microseconds for strict keyset paging", () => {
    const cursor = {
      createdAt: "2026-09-23T10:00:00.123456Z",
      id: "018f0000-0000-7000-8000-000000000002",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "not-base64", "e30", "eyJjcmVhdGVkQXQiOiJiYWQifQ"])(
    "rejects malformed cursor %j",
    (value) => {
      expect(() => decodeCursor(value)).toThrow(DomainValidationError);
    },
  );
});
