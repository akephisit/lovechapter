import {
  GUEST_IMPORT_FIELDS,
  type GuestImportMapping,
} from "@lovechapter/contracts";

import { useUiCopy } from "../ui-language-provider";

export function ColumnMapping({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: GuestImportMapping;
  onChange(mapping: GuestImportMapping): void;
}) {
  const copy = useUiCopy();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {GUEST_IMPORT_FIELDS.map((field) => (
        <label className="grid gap-1 text-sm" key={field}>
          {copy.csv.fields[field]}
          {field === "name" ? copy.csv.required : ""}
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
            <option value="">{copy.csv.doNotImport}</option>
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
