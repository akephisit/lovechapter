import { DomainValidationError } from "./errors";

export type ListCursor = {
  createdAt: string;
  id: string;
};

export function encodeCursor(cursor: ListCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeCursor(value: string): ListCursor {
  try {
    if (!value) throw new Error("empty");
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!isListCursor(parsed)) throw new Error("shape");
    return parsed;
  } catch {
    throw new DomainValidationError("Invalid pagination cursor");
  }
}

function isListCursor(value: unknown): value is ListCursor {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  if (typeof cursor.createdAt !== "string" || typeof cursor.id !== "string") {
    return false;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(
      cursor.createdAt,
    )
  ) {
    return false;
  }
  if (Number.isNaN(Date.parse(cursor.createdAt))) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    cursor.id,
  );
}
