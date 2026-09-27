"use client";

import type {
  CreateGuestAffiliationInput,
  GuestAffiliation,
  GuestImportCommitInput,
  GuestImportCommitResult,
  GuestImportMappingInput,
  GuestImportPreview,
  GuestImportPreviewRow,
} from "@lovechapter/contracts";
import { useEffect, useState } from "react";

import { safeUiError } from "../../lib/ui-error";
import { localizeStoredUiMessage, type UiCopy } from "../../lib/ui-copy";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useUiCopy } from "../ui-language-provider";
import { ColumnMapping, isValidColumnMapping } from "./column-mapping";
import { ImportPreviewTable } from "./import-preview-table";

export interface GuestImportApi {
  uploadGuestCsv(weddingId: string, file: File): Promise<GuestImportPreview>;
  getGuestImportPreview(
    weddingId: string,
    batchId: string,
    cursor?: string,
  ): Promise<GuestImportPreview>;
  updateGuestImportMapping(
    weddingId: string,
    batchId: string,
    input: GuestImportMappingInput,
  ): Promise<GuestImportPreview>;
  commitGuestImport(
    weddingId: string,
    batchId: string,
    input: GuestImportCommitInput,
  ): Promise<GuestImportCommitResult>;
  createGuestAffiliation(
    weddingId: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation>;
}

export function GuestImportWorkspace({
  weddingId,
  affiliations,
  api,
  onImported,
  onAffiliationCreated,
  onDraftChange,
}: {
  weddingId: string;
  affiliations: GuestAffiliation[];
  api: GuestImportApi;
  onImported(): void;
  onAffiliationCreated?(affiliation: GuestAffiliation): void;
  onDraftChange?(dirty: boolean): void;
}) {
  const copy = useUiCopy();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"select" | "map" | "review" | "done">(
    "select",
  );
  const [preview, setPreview] = useState<GuestImportPreview | null>(null);
  const [rows, setRows] = useState<GuestImportPreviewRow[]>([]);
  const [mapping, setMapping] = useState<GuestImportPreview["mapping"] | null>(
    null,
  );
  const [affiliationMappings, setAffiliationMappings] = useState<
    Record<string, string>
  >({});
  const [knownAffiliations, setKnownAffiliations] =
    useState<GuestAffiliation[]>(affiliations);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestImportCommitResult | null>(null);
  const [page, setPage] = useState(0);
  const hasDraft = step !== "done" && (file !== null || step !== "select");

  useEffect(() => {
    onDraftChange?.(hasDraft);
  }, [hasDraft, onDraftChange]);

  async function collect(first: GuestImportPreview) {
    const collected = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await api.getGuestImportPreview(
        weddingId,
        first.batchId,
        cursor,
      );
      if (next.mappingVersion !== first.mappingVersion)
        throw new Error("Preview changed. Please reload the import.");
      collected.push(...next.items);
      cursor = next.nextCursor;
    }
    setPreview(first);
    setRows(collected);
    setPage(0);
    return collected;
  }

  async function upload() {
    if (!file || !/\.csv$/i.test(file.name)) {
      setError(copy.csv.selectError);
      return;
    }
    if (file.size > 1024 * 1024) {
      setError(copy.csv.sizeError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await api.uploadGuestCsv(weddingId, file);
      await collect(uploaded);
      setMapping(uploaded.mapping);
      setAffiliationMappings(uploaded.affiliationMappings);
      setConfirmed(new Set());
      setKey(crypto.randomUUID());
      setStep("map");
    } catch (cause) {
      setError(readError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  async function apply(
    excludedRowIds: string[],
    nextMappings = affiliationMappings,
    nextMapping = mapping,
  ) {
    if (!preview || !nextMapping) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateGuestImportMapping(
        weddingId,
        preview.batchId,
        {
          expectedVersion: preview.mappingVersion,
          mapping: nextMapping,
          affiliationMappings: nextMappings,
          excludedRowIds,
        },
      );
      await collect(updated);
      setMapping(updated.mapping);
      setAffiliationMappings(updated.affiliationMappings);
      setConfirmed(new Set());
      return true;
    } catch (cause) {
      setError(readError(cause, copy));
      if (
        typeof cause === "object" &&
        cause &&
        "status" in cause &&
        cause.status === 409
      ) {
        try {
          const current = await api.getGuestImportPreview(
            weddingId,
            preview.batchId,
          );
          await collect(current);
          setMapping(current.mapping);
          setAffiliationMappings(current.affiliationMappings);
          setConfirmed(new Set());
        } catch {
          /* keep visible error */
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unknown = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.errors.includes("Unknown affiliation") && row.sourceAffiliation,
        )
        .map((row) => row.sourceAffiliation!),
    ),
  ];
  const excluded = rows.filter((row) => !row.included).map((row) => row.id);
  const invalid = rows.some(
    (row) => row.included && (row.errors.length || !row.candidate),
  );
  const unconfirmed = rows.some(
    (row) => row.included && row.warnings.length && !confirmed.has(row.id),
  );

  async function commit() {
    if (!preview || invalid || unconfirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.commitGuestImport(weddingId, preview.batchId, {
        expectedVersion: preview.mappingVersion,
        includedRowIds: rows.filter((row) => row.included).map((row) => row.id),
        createAnywayRowIds: rows
          .filter(
            (row) =>
              row.included && row.warnings.length && confirmed.has(row.id),
          )
          .map((row) => row.id),
        idempotencyKey: key,
      });
      setResult(saved);
      setStep("done");
      onImported();
    } catch (cause) {
      setError(readError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  async function createSide(name: string) {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createGuestAffiliation(weddingId, {
        name,
        color: "#a855f7",
      });
      setKnownAffiliations((current) => [...current, created]);
      onAffiliationCreated?.(created);
      const next = {
        ...affiliationMappings,
        [name.toLocaleLowerCase()]: created.id,
      };
      setAffiliationMappings(next);
      await apply(excluded, next);
    } catch (cause) {
      setError(readError(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h3 className="font-serif text-2xl font-semibold">{copy.csv.title}</h3>
      <p className="text-sm text-[#806d70]">{copy.csv.description}</p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {localizeStoredUiMessage(error, copy)}
        </p>
      ) : null}
      {step === "select" ? (
        <div className="space-y-3">
          <label className="block text-sm">
            {copy.csv.select}{" "}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button disabled={busy} onClick={() => void upload()}>
            {busy ? copy.csv.uploading : copy.csv.upload}
          </Button>
        </div>
      ) : null}
      {step === "map" && preview && mapping ? (
        <div className="space-y-4">
          <p className="text-sm">{copy.csv.mapStep}</p>
          <ColumnMapping
            headers={preview.headers}
            mapping={mapping}
            onChange={setMapping}
          />
          <Button
            disabled={busy || !isValidColumnMapping(mapping)}
            onClick={() =>
              void (async () => {
                if (
                  JSON.stringify(mapping) !== JSON.stringify(preview.mapping) &&
                  !(await apply(excluded))
                )
                  return;
                setStep("review");
              })()
            }
          >
            {copy.csv.review}
          </Button>
        </div>
      ) : null}
      {step === "review" && preview ? (
        <div className="space-y-4">
          <p className="text-sm">
            {copy.csv.reviewStep(
              preview.totals.valid,
              preview.totals.warning,
              preview.totals.invalid,
              preview.totals.excluded,
            )}
          </p>
          {unknown.map((name) => (
            <div
              key={name}
              className="space-x-2 rounded-lg bg-[#fff3ed] p-2 text-sm"
            >
              <span>{copy.csv.unknownSide(name)}</span>
              <select
                aria-label={copy.csv.mapSide(name)}
                className="rounded border p-1"
                defaultValue=""
                disabled={busy}
                onChange={(event) => {
                  if (!event.target.value) return;
                  const next = {
                    ...affiliationMappings,
                    [name.toLocaleLowerCase()]: event.target.value,
                  };
                  setAffiliationMappings(next);
                  void apply(excluded, next);
                }}
              >
                <option value="">{copy.csv.chooseSide}</option>
                {knownAffiliations.map((side) => (
                  <option key={side.id} value={side.id}>
                    {side.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void createSide(name)}
              >
                {copy.csv.createSide}
              </Button>
            </div>
          ))}
          <ImportPreviewTable
            rows={rows.slice(page * 50, page * 50 + 50)}
            busy={busy}
            confirmed={confirmed}
            onConfirm={(id, value) =>
              setConfirmed((current) => {
                const next = new Set(current);
                if (value) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onExclude={(id, value) =>
              void apply(
                value
                  ? [...excluded, id]
                  : excluded.filter((rowId) => rowId !== id),
              )
            }
          />
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 0 || busy}
              onClick={() => setPage(page - 1)}
            >
              {copy.csv.previous}
            </Button>
            <span>
              {copy.csv.page(
                page + 1,
                Math.max(1, Math.ceil(rows.length / 50)),
              )}
            </span>
            <Button
              variant="secondary"
              disabled={(page + 1) * 50 >= rows.length || busy}
              onClick={() => setPage(page + 1)}
            >
              {copy.csv.next}
            </Button>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setStep("map")}
          >
            {copy.csv.editMapping}
          </Button>
          <Button
            disabled={busy || invalid || unconfirmed}
            onClick={() => void commit()}
          >
            {busy ? copy.csv.importing : copy.csv.import}
          </Button>
        </div>
      ) : null}
      {step === "done" && result ? (
        <div role="status" className="space-y-2 text-sm">
          <p>{copy.csv.done(result.created, result.excluded)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setStep("select");
              setFile(null);
              setPreview(null);
              setRows([]);
              setKey("");
            }}
          >
            {copy.csv.another}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function readError(error: unknown, copy: UiCopy): string {
  if (
    (error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 409) ||
    (error instanceof Error &&
      error.message === "Preview changed. Please reload the import.")
  ) {
    return copy.csv.changed;
  }
  return safeUiError(error, copy, copy.csv.error);
}
