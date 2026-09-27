import type { GuestImportPreviewRow } from "@lovechapter/contracts";
import type { UiCopy } from "../../lib/ui-copy";
import { useUiCopy } from "../ui-language-provider";

export function ImportPreviewTable({
  rows,
  confirmed,
  onConfirm,
  onExclude,
  busy,
}: {
  rows: GuestImportPreviewRow[];
  confirmed: Set<string>;
  onConfirm(id: string, value: boolean): void;
  onExclude(id: string, value: boolean): void;
  busy: boolean;
}) {
  const copy = useUiCopy();
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="rounded-xl border border-[#eadbd2] bg-white p-3 text-sm"
        >
          <p>
            {copy.csv.row(row.rowNumber)}{" "}
            <span className="font-semibold">
              {row.candidate?.name ?? row.sourceName ?? copy.csv.invalidRow}
            </span>
            {row.sourceAffiliation ? (
              <span> · {row.sourceAffiliation}</span>
            ) : null}
          </p>
          {row.candidate ? (
            <div className="my-2 space-y-1 text-[#68585a]">
              <p>
                {copy.csv.partySize(row.candidate.allowedPartySize)}
                {row.candidate.email
                  ? ` · ${copy.csv.email(row.candidate.email)}`
                  : ""}
                {row.candidate.phone
                  ? ` · ${copy.csv.phone(row.candidate.phone)}`
                  : ""}
              </p>
              {row.candidate.envelopeName ? (
                <p>{copy.csv.envelope(row.candidate.envelopeName)}</p>
              ) : null}
              {row.candidate.postalAddress ? (
                <p>
                  {copy.csv.address(
                    [
                      row.candidate.postalAddress.addressLine1,
                      row.candidate.postalAddress.addressLine2,
                      row.candidate.postalAddress.locality,
                      row.candidate.postalAddress.administrativeArea,
                      row.candidate.postalAddress.postalCode,
                      row.candidate.postalAddress.countryCode,
                    ]
                      .filter(Boolean)
                      .join(", "),
                  )}
                </p>
              ) : null}
              {row.candidate.note ? (
                <p>{copy.csv.note(row.candidate.note)}</p>
              ) : null}
            </div>
          ) : null}
          {row.errors.length ? (
            <p className="text-red-700">
              {row.errors.map((error) => rowMessage(error, copy)).join("; ")}
            </p>
          ) : null}
          {row.warnings.length ? (
            <p className="text-amber-800">
              {row.warnings
                .map((warning) => rowMessage(warning, copy))
                .join("; ")}
            </p>
          ) : null}
          <label className="mr-4 inline-flex items-center gap-2">
            <input
              type="checkbox"
              disabled={busy}
              checked={!row.included}
              onChange={(event) => onExclude(row.id, event.target.checked)}
            />
            {copy.csv.exclude(row.rowNumber)}
          </label>
          {row.included && row.warnings.length ? (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                aria-label={copy.csv.createAnywayRow(row.rowNumber)}
                checked={confirmed.has(row.id)}
                onChange={(event) => onConfirm(row.id, event.target.checked)}
              />
              {copy.csv.createAnyway}
            </label>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function rowMessage(message: string, copy: UiCopy): string {
  switch (message) {
    case "Unknown affiliation":
      return copy.csv.unknownAffiliation;
    case "Address line 1 is required when other address fields are present":
      return copy.csv.addressRequired;
    case "Duplicate email in file":
      return copy.csv.duplicateEmail;
    case "Duplicate name and phone in file":
      return copy.csv.duplicateNamePhone;
    case "Likely duplicate email":
      return copy.csv.likelyDuplicateEmail;
    case "Likely duplicate name and phone":
      return copy.csv.likelyDuplicateNamePhone;
    default:
      return copy.csv.rowError;
  }
}
