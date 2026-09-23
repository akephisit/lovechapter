import { describe, expect, it } from "vitest";
import type { GuestImportMapping } from "@lovechapter/contracts";

import {
  autoMapGuestHeaders,
  buildGuestImportCandidates,
  addWithinFileDuplicateWarnings,
  safeImportedText,
  validateGuestImportMapping,
} from "./guest-import";

describe("guest import mapping", () => {
  it("auto-maps documented English headers and rejects missing/duplicate destinations", () => {
    const headers = ["Name", "email", "allowed_party_size", "affiliation"];
    const mapping = autoMapGuestHeaders(headers);
    expect(mapping).toMatchObject({
      name: 0,
      email: 1,
      allowedPartySize: 2,
      affiliation: 3,
    });
    expect(() =>
      validateGuestImportMapping(headers, { ...mapping, email: 0 }),
    ).toThrow();
    expect(() =>
      validateGuestImportMapping(headers, { ...mapping, name: null }),
    ).toThrow();
  });

  it("neutralizes spreadsheet formulas even behind whitespace", () => {
    expect(safeImportedText("  =2+2")).toBe("'  =2+2");
    expect(safeImportedText("\t@cmd")).toBe("'\t@cmd");
    expect(safeImportedText("Normal name")).toBe("Normal name");
  });

  it("validates optional address, party default, existing affiliations and duplicate warnings", () => {
    const mapping = autoMapGuestHeaders([
      "name",
      "email",
      "phone",
      "affiliation",
      "address_line_1",
    ]);
    const family = {
      id: "018f0000-0000-7000-8000-000000000004",
      name: "Family",
      color: "#a855f7",
      sortOrder: 0,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const rows = buildGuestImportCandidates({
      rows: [
        {
          id: "a",
          rowNumber: 2,
          values: ["Nok", "NOK@EXAMPLE.TEST", "123", "family", ""],
          included: true,
        },
        {
          id: "b",
          rowNumber: 3,
          values: ["nok", "nok@example.test", "123", "family", ""],
          included: true,
        },
        {
          id: "c",
          rowNumber: 4,
          values: ["Dao", "", "", "", "123 Lane"],
          included: true,
        },
        {
          id: "d",
          rowNumber: 5,
          values: ["Lee", "", "", "unknown", ""],
          included: true,
        },
      ],
      mapping,
      affiliations: [family],
      affiliationMappings: {},
    });
    expect(rows[0]?.candidate).toMatchObject({
      name: "Nok",
      email: "nok@example.test",
      affiliationId: family.id,
      allowedPartySize: 1,
    });
    expect(rows[0]?.candidate).not.toHaveProperty("postalAddress");
    expect(rows[3]?.errors).toContain("Unknown affiliation");
    expect(rows[2]?.candidate?.postalAddress).toMatchObject({
      addressLine1: "123 Lane",
    });
    expect(addWithinFileDuplicateWarnings(rows)[0]?.warnings).toEqual(
      expect.arrayContaining([
        "Duplicate email in file",
        "Duplicate name and phone in file",
      ]),
    );
  });

  it("enforces server guest limits without returning raw source in errors", () => {
    const mapping: GuestImportMapping = autoMapGuestHeaders(["name"]);
    const rows = buildGuestImportCandidates({
      rows: [
        { id: "x", rowNumber: 2, values: ["N".repeat(121)], included: true },
      ],
      mapping,
      affiliations: [],
      affiliationMappings: {},
    });
    expect(rows[0]?.candidate).toBeNull();
    expect(rows[0]?.errors[0]).not.toContain("N".repeat(121));
  });
});
