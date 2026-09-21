import { DomainValidationError } from "./errors";

export type RsvpSubmission = {
  attendance: "attending" | "declined";
  partySize: number;
  note?: string;
};

export function validateRsvp(
  input: RsvpSubmission,
  allowedPartySize: number,
): RsvpSubmission {
  if (!Number.isInteger(allowedPartySize) || allowedPartySize < 1) {
    throw new DomainValidationError("Guest allowance must be at least 1");
  }
  if (!Number.isInteger(input.partySize)) {
    throw new DomainValidationError("Party size must be a whole number");
  }
  if (input.attendance === "attending") {
    if (input.partySize < 1) throw new DomainValidationError("at least 1");
    if (input.partySize > allowedPartySize) {
      throw new DomainValidationError("allowance");
    }
  } else if (input.partySize !== 0) {
    throw new DomainValidationError("must be 0");
  }

  const note = input.note?.trim();
  if (note && note.length > 500) {
    throw new DomainValidationError("500 characters");
  }
  return note
    ? { attendance: input.attendance, partySize: input.partySize, note }
    : { attendance: input.attendance, partySize: input.partySize };
}
