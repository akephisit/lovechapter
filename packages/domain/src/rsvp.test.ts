import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./errors";
import { validateRsvp } from "./rsvp";

describe("RSVP validation", () => {
  it("accepts an attending party within the guest allowance", () => {
    expect(
      validateRsvp(
        { attendance: "attending", partySize: 2, note: "Vegetarian" },
        2,
      ),
    ).toEqual({
      attendance: "attending",
      note: "Vegetarian",
      partySize: 2,
    });
  });

  it.each([
    [{ attendance: "attending" as const, partySize: 0 }, 2, "at least 1"],
    [{ attendance: "attending" as const, partySize: 3 }, 2, "allowance"],
    [{ attendance: "declined" as const, partySize: 1 }, 2, "must be 0"],
  ])("rejects inconsistent party size %#", (input, allowance, message) => {
    expect(() => validateRsvp(input, allowance)).toThrowError(
      new DomainValidationError(message),
    );
  });

  it("normalizes a declined RSVP to an empty note", () => {
    expect(
      validateRsvp({ attendance: "declined", partySize: 0, note: "  " }, 4),
    ).toEqual({ attendance: "declined", partySize: 0 });
  });

  it("rejects notes longer than 500 characters", () => {
    expect(() =>
      validateRsvp(
        { attendance: "attending", partySize: 1, note: "x".repeat(501) },
        1,
      ),
    ).toThrowError(new DomainValidationError("500 characters"));
  });
});
