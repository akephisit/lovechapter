import type { GuestCsvRow } from "@lovechapter/contracts";

export const GUEST_CSV_HEADER = [
  "name",
  "email",
  "phone",
  "allowed_party_size",
  "affiliation",
  "envelope_name",
  "address_line_1",
  "address_line_2",
  "locality",
  "administrative_area",
  "postal_code",
  "country_code",
  "note",
  "rsvp_status",
  "rsvp_party_size",
] as const;

export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[\t ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const cell =
    typeof value === "number"
      ? String(value)
      : neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function encodeGuestCsvHeader(): string {
  return `\uFEFF${GUEST_CSV_HEADER.join(",")}\r\n`;
}

export function encodeGuestCsvRow(row: GuestCsvRow): string {
  const cells = [
    row.name,
    row.email,
    row.phone,
    row.allowedPartySize,
    row.affiliation,
    row.envelopeName,
    row.addressLine1,
    row.addressLine2,
    row.locality,
    row.administrativeArea,
    row.postalCode,
    row.countryCode,
    row.note,
    row.rsvpStatus,
    row.rsvpPartySize,
  ];
  return `${cells.map(csvCell).join(",")}\r\n`;
}
