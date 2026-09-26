import {
  GUEST_IMPORT_FIELDS,
  type CreateGuestInput,
  type GuestAffiliation,
  type GuestImportField,
  type GuestImportMapping,
  type GuestImportPreviewRow,
} from "@lovechapter/contracts";

import { DomainValidationError } from "./errors";
import { normalizeGuestCreate } from "./service";

const columnNames: Record<GuestImportField, string[]> = {
  name: ["name"],
  email: ["email"],
  phone: ["phone"],
  allowedPartySize: ["allowed_party_size", "allowedpartysize"],
  affiliation: ["affiliation"],
  envelopeName: ["envelope_name", "envelopename"],
  addressLine1: ["address_line_1", "addressline1"],
  addressLine2: ["address_line_2", "addressline2"],
  locality: ["locality"],
  administrativeArea: ["administrative_area", "administrativearea"],
  postalCode: ["postal_code", "postalcode"],
  countryCode: ["country_code", "countrycode"],
  note: ["note"],
};

export function normalizeGuestImportHeader(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s-]+/gu, "_");
}

export function encodeGuestImportCursor(rowNumber: number, id: string): string {
  return btoa(JSON.stringify({ rowNumber, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeGuestImportCursor(value: string): {
  rowNumber: number;
  id: string;
} {
  try {
    if (!value || value.length > 200) throw new Error();
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    ) as Record<string, unknown>;
    if (
      !Number.isInteger(parsed.rowNumber) ||
      Number(parsed.rowNumber) < 2 ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.id)
    )
      throw new Error();
    return { rowNumber: Number(parsed.rowNumber), id: parsed.id };
  } catch {
    throw new DomainValidationError("Invalid guest import cursor");
  }
}

export function autoMapGuestHeaders(headers: string[]): GuestImportMapping {
  return Object.fromEntries(
    GUEST_IMPORT_FIELDS.map((field) => {
      const index = headers.findIndex((header) =>
        columnNames[field].includes(normalizeGuestImportHeader(header)),
      );
      return [field, index === -1 ? null : index];
    }),
  ) as GuestImportMapping;
}

export function validateGuestImportMapping(
  headers: string[],
  mapping: GuestImportMapping,
): void {
  if (mapping.name === null || mapping.name === undefined)
    throw new DomainValidationError("Name column is required");
  const assigned = GUEST_IMPORT_FIELDS.map((field) => mapping[field]).filter(
    (value) => value !== null,
  );
  if (
    assigned.some(
      (index) =>
        !Number.isInteger(index) || index! < 0 || index! >= headers.length,
    ) ||
    new Set(assigned).size !== assigned.length
  ) {
    throw new DomainValidationError(
      "Invalid or duplicate guest import column mapping",
    );
  }
}

export function safeImportedText(value: string): string {
  return /^[\t ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function buildGuestImportCandidates(input: {
  rows: Array<{
    id: string;
    rowNumber: number;
    values: string[];
    included: boolean;
  }>;
  mapping: GuestImportMapping;
  affiliations: GuestAffiliation[];
  affiliationMappings: Record<string, string>;
}): GuestImportPreviewRow[] {
  return input.rows.map((source): GuestImportPreviewRow => {
    const field = (key: GuestImportField): string => {
      const index = input.mapping[key];
      return index === null ? "" : (source.values[index] ?? "").trim();
    };
    const errors: string[] = [];
    let candidate: CreateGuestInput | null = null;
    const affiliationName = field("affiliation");
    const explicitId =
      input.affiliationMappings[affiliationName.toLocaleLowerCase()];
    const affiliation = affiliationName
      ? input.affiliations.find((item) =>
          explicitId
            ? item.id === explicitId
            : item.name.toLocaleLowerCase() ===
              affiliationName.toLocaleLowerCase(),
        )
      : undefined;
    if (affiliationName && !affiliation) errors.push("Unknown affiliation");
    const addressLine1 = field("addressLine1");
    const addressExtras = [
      "addressLine2",
      "locality",
      "administrativeArea",
      "postalCode",
      "countryCode",
    ] as const;
    if (!addressLine1 && addressExtras.some((key) => field(key)))
      errors.push(
        "Address line 1 is required when other address fields are present",
      );
    try {
      const party = field("allowedPartySize");
      const draft: CreateGuestInput = {
        name: safeImportedText(field("name")),
        allowedPartySize: party ? Number(party) : 1,
        ...(field("email") ? { email: field("email") } : {}),
        ...(field("phone") ? { phone: field("phone") } : {}),
        ...(affiliation ? { affiliationId: affiliation.id } : {}),
        ...(field("envelopeName")
          ? { envelopeName: safeImportedText(field("envelopeName")) }
          : {}),
        ...(field("note") ? { note: safeImportedText(field("note")) } : {}),
        ...(addressLine1
          ? {
              postalAddress: {
                addressLine1: safeImportedText(addressLine1),
                ...Object.fromEntries(
                  addressExtras
                    .filter((key) => field(key))
                    .map((key) => [key, safeImportedText(field(key))]),
                ),
              },
            }
          : {}),
      };
      candidate = normalizeGuestCreate(draft);
    } catch (error) {
      errors.push(
        error instanceof DomainValidationError
          ? error.message
          : "Invalid guest row",
      );
    }
    return {
      id: source.id,
      rowNumber: source.rowNumber,
      sourceName: field("name") || null,
      sourceAffiliation: affiliationName || null,
      candidate: errors.length ? null : candidate,
      errors,
      warnings: [],
      included: source.included,
    };
  });
}

export function addWithinFileDuplicateWarnings(
  rows: GuestImportPreviewRow[],
): GuestImportPreviewRow[] {
  const emails = new Map<string, string[]>();
  const namePhones = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.candidate) continue;
    if (row.candidate.email) {
      const key = row.candidate.email.toLocaleLowerCase();
      emails.set(key, [...(emails.get(key) ?? []), row.id]);
    }
    if (row.candidate.phone) {
      const key = `${row.candidate.name.toLocaleLowerCase()}\0${row.candidate.phone}`;
      namePhones.set(key, [...(namePhones.get(key) ?? []), row.id]);
    }
  }
  const duplicateEmails = new Set(
    [...emails.values()].filter((ids) => ids.length > 1).flat(),
  );
  const duplicateNamePhones = new Set(
    [...namePhones.values()].filter((ids) => ids.length > 1).flat(),
  );
  return rows.map((row) => ({
    ...row,
    warnings: [
      ...row.warnings,
      ...(duplicateEmails.has(row.id) ? ["Duplicate email in file"] : []),
      ...(duplicateNamePhones.has(row.id)
        ? ["Duplicate name and phone in file"]
        : []),
    ],
  }));
}
