import type { GuestImportPreviewRow } from "@lovechapter/contracts";

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
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="rounded-xl border border-[#eadbd2] bg-white p-3 text-sm"
        >
          <p>
            Row {row.rowNumber}:{" "}
            <span className="font-semibold">
              {row.candidate?.name ?? row.sourceName ?? "Invalid row"}
            </span>
            {row.sourceAffiliation ? (
              <span> · {row.sourceAffiliation}</span>
            ) : null}
          </p>
          {row.candidate ? (
            <div className="my-2 space-y-1 text-[#68585a]">
              <p>
                Party size: {row.candidate.allowedPartySize}
                {row.candidate.email ? ` · Email: ${row.candidate.email}` : ""}
                {row.candidate.phone ? ` · Phone: ${row.candidate.phone}` : ""}
              </p>
              {row.candidate.envelopeName ? (
                <p>Envelope: {row.candidate.envelopeName}</p>
              ) : null}
              {row.candidate.postalAddress ? (
                <p>
                  Address:{" "}
                  {[
                    row.candidate.postalAddress.addressLine1,
                    row.candidate.postalAddress.addressLine2,
                    row.candidate.postalAddress.locality,
                    row.candidate.postalAddress.administrativeArea,
                    row.candidate.postalAddress.postalCode,
                    row.candidate.postalAddress.countryCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
              {row.candidate.note ? <p>Note: {row.candidate.note}</p> : null}
            </div>
          ) : null}
          {row.errors.length ? (
            <p className="text-red-700">{row.errors.join("; ")}</p>
          ) : null}
          {row.warnings.length ? (
            <p className="text-amber-800">{row.warnings.join("; ")}</p>
          ) : null}
          <label className="mr-4 inline-flex items-center gap-2">
            <input
              type="checkbox"
              disabled={busy}
              checked={!row.included}
              onChange={(event) => onExclude(row.id, event.target.checked)}
            />
            Exclude row {row.rowNumber}
          </label>
          {row.included && row.warnings.length ? (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                aria-label={`Create anyway row ${row.rowNumber}`}
                checked={confirmed.has(row.id)}
                onChange={(event) => onConfirm(row.id, event.target.checked)}
              />
              Create anyway
            </label>
          ) : null}
        </div>
      ))}
    </div>
  );
}
