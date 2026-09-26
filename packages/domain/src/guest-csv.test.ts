import { describe, expect, it } from "vitest";

import { csvCell, encodeGuestCsvHeader, encodeGuestCsvRow } from "./guest-csv";

describe("guest CSV encoding", () => {
  it("emits the exact BOM, 15-column header, and CRLF", () => {
    expect(encodeGuestCsvHeader()).toBe(
      "\uFEFFname,email,phone,allowed_party_size,affiliation,envelope_name,address_line_1,address_line_2,locality,administrative_area,postal_code,country_code,note,rsvp_status,rsvp_party_size\r\n",
    );
  });

  it.each(["=SUM(1)", "+1", "-1", "@SUM(1)", " \t=HYPERLINK(1)", "\t +1"])(
    "neutralizes formula string %s without losing its original display text",
    (value) => {
      const encoded = csvCell(value);
      expect(readCells(`${encoded}\r\n`)).toEqual([`'${value}`]);
    },
  );

  it("round-trips Unicode, quotes, commas, multiline notes, empty optionals and zero", () => {
    const encoded = encodeGuestCsvRow({
      name: 'คุณสมชาย, "เพื่อน" 😊',
      email: null,
      phone: null,
      allowedPartySize: 0,
      affiliation: "ครอบครัว",
      envelopeName: null,
      addressLine1: null,
      addressLine2: null,
      locality: null,
      administrativeArea: null,
      postalCode: null,
      countryCode: null,
      note: 'first line\r\n"second" line',
      rsvpStatus: null,
      rsvpPartySize: 0,
    });
    expect(encoded.endsWith("\r\n")).toBe(true);
    expect(readCells(encoded)).toEqual([
      'คุณสมชาย, "เพื่อน" 😊',
      "",
      "",
      "0",
      "ครอบครัว",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      'first line\r\n"second" line',
      "",
      "0",
    ]);
  });
});

function readCells(record: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < record.length - 2; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}
