import {
  GUEST_IMPORT_FIELDS,
  type GuestImportField,
  type GuestImportMapping,
} from "@lovechapter/contracts";

const labels: Record<GuestImportField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  allowedPartySize: "Party size",
  affiliation: "Guest side",
  envelopeName: "Envelope name",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  locality: "Locality",
  administrativeArea: "Province / state",
  postalCode: "Postal code",
  countryCode: "Country code",
  note: "Note",
};

export function ColumnMapping({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: GuestImportMapping;
  onChange(mapping: GuestImportMapping): void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {GUEST_IMPORT_FIELDS.map((field) => (
        <label className="grid gap-1 text-sm" key={field}>
          {labels[field]}
          {field === "name" ? " (required)" : ""}
          <select
            className="rounded-lg border border-[#d7beb5] bg-white p-2"
            value={mapping[field] ?? ""}
            onChange={(event) =>
              onChange({
                ...mapping,
                [field]:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">Do not import</option>
            {headers.map((header, index) => (
              <option key={index} value={index}>
                {header}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

export function isValidColumnMapping(mapping: GuestImportMapping): boolean {
  const assigned = Object.values(mapping).filter(
    (value): value is number => value !== null,
  );
  return mapping.name !== null && new Set(assigned).size === assigned.length;
}
