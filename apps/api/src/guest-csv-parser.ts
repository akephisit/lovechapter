import { Readable } from "node:stream";

import { DomainValidationError } from "@lovechapter/domain";
import { parse } from "csv-parse";

export const MAX_GUEST_CSV_ROWS = 5_000;
export const MAX_GUEST_CSV_COLUMNS = 40;
export const MAX_GUEST_CSV_CELL_CHARACTERS = 4_096;
const MAX_UPLOAD_BYTES = 1_048_576;

export type ParsedGuestCsv = {
  sourceSha256: string;
  headers: string[];
  rows: string[][];
};

export class GuestCsvParseError extends DomainValidationError {
  constructor(
    readonly code: string,
    readonly rowNumber?: number,
  ) {
    super(
      `Invalid guest CSV (${code}${rowNumber ? ` at row ${rowNumber}` : ""})`,
    );
  }
}

export async function parseGuestCsv(
  bytes: Uint8Array,
): Promise<ParsedGuestCsv> {
  if (bytes.byteLength === 0) throw new GuestCsvParseError("empty_file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new GuestCsvParseError("file_too_large");
  if (bytes.includes(0)) throw new GuestCsvParseError("binary_input");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GuestCsvParseError("invalid_utf8");
  }
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const sourceSha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const records = Readable.from([decoded]).pipe(
    parse({
      bom: true,
      delimiter: ",",
      record_delimiter: ["\r\n", "\n"],
      skip_empty_lines: true,
      max_record_size: MAX_UPLOAD_BYTES,
    }),
  );
  let headers: string[] | null = null;
  const rows: string[][] = [];
  try {
    for await (const record of records as AsyncIterable<string[]>) {
      if (
        record.some(
          (value) => Array.from(value).length > MAX_GUEST_CSV_CELL_CHARACTERS,
        )
      ) {
        throw new GuestCsvParseError(
          "cell_too_long",
          headers ? rows.length + 2 : 1,
        );
      }
      if (!headers) {
        if (record.length > MAX_GUEST_CSV_COLUMNS)
          throw new GuestCsvParseError("too_many_columns");
        if (record.length === 1 && /[;\t]/u.test(record[0] ?? "")) {
          throw new GuestCsvParseError("unsupported_delimiter");
        }
        const normalized = record.map((value) =>
          value.trim().normalize("NFKC").toLocaleLowerCase(),
        );
        if (normalized.some((value) => !value))
          throw new GuestCsvParseError("invalid_header");
        if (new Set(normalized).size !== normalized.length)
          throw new GuestCsvParseError("duplicate_header");
        headers = record;
      } else {
        if (rows.length >= MAX_GUEST_CSV_ROWS)
          throw new GuestCsvParseError("too_many_rows", rows.length + 2);
        rows.push(record);
      }
    }
  } catch (error) {
    if (error instanceof GuestCsvParseError) throw error;
    throw new GuestCsvParseError("malformed_csv");
  }
  if (!headers) throw new GuestCsvParseError("empty_file");
  return { sourceSha256, headers, rows };
}
