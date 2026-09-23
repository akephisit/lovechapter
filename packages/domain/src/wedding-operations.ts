import type {
  Budget,
  BudgetCategoryInput,
  ExpenseInput,
  RunSheetItemInput,
  SeatingTableInput,
  VendorInput,
} from "@lovechapter/contracts";

import { DomainValidationError } from "./errors";

const MAX_MINOR = 1_000_000_000_000;

function required(value: string, label: string, length: number): string {
  const text = value.trim();
  if (!text || Array.from(text).length > length)
    throw new DomainValidationError(`${label} must be 1–${length} characters`);
  return text;
}

function optional(
  value: string | null | undefined,
  length: number,
): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (Array.from(text).length > length)
    throw new DomainValidationError(
      `Text must be at most ${length} characters`,
    );
  return text || null;
}

function amount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR)
    throw new DomainValidationError(
      `${label} must be a valid nonnegative minor-unit amount`,
    );
  return value;
}

export function currencyDigits(currency: string): number {
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !Intl.supportedValuesOf("currency").includes(currency)
  )
    throw new DomainValidationError("Invalid currency code");
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    throw new DomainValidationError("Invalid currency code");
  }
}

export function parseMoney(value: string, rawCurrency: string): number {
  const currency = rawCurrency.toUpperCase();
  const digits = currencyDigits(currency);
  const pattern = digits
    ? new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`)
    : /^\d+$/;
  if (!pattern.test(value))
    throw new DomainValidationError("Invalid monetary amount");
  const [whole, fraction = ""] = value.split(".");
  const minor =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  return amount(minor, "Amount");
}

function calendarDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new DomainValidationError("Invalid date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new DomainValidationError("Invalid date");
  return value;
}

export function normalizeBudget(input: Budget): Budget {
  const currency = input.currency.trim().toUpperCase();
  currencyDigits(currency);
  return {
    currency,
    targetMinor:
      input.targetMinor == null ? null : amount(input.targetMinor, "Target"),
  };
}

export function normalizeBudgetCategory(
  input: BudgetCategoryInput,
): BudgetCategoryInput {
  return { name: required(input.name, "Category name", 80) };
}

export function normalizeVendor(input: VendorInput): Required<VendorInput> {
  if (
    !["researching", "contacted", "booked", "cancelled"].includes(input.status)
  )
    throw new DomainValidationError("Invalid vendor status");
  return {
    name: required(input.name, "Vendor name", 180),
    status: input.status,
    contactName: optional(input.contactName, 120),
    email: optional(input.email, 320),
    phone: optional(input.phone, 40),
    quoteMinor:
      input.quoteMinor == null ? null : amount(input.quoteMinor, "Quote"),
    note: optional(input.note, 2_000),
  };
}

export function normalizeExpense(input: ExpenseInput): Required<ExpenseInput> {
  const plannedMinor = amount(input.plannedMinor, "Planned amount");
  const paidMinor = amount(input.paidMinor, "Paid amount");
  if (paidMinor > plannedMinor)
    throw new DomainValidationError("Paid amount exceeds planned amount");
  return {
    title: required(input.title, "Expense title", 180),
    plannedMinor,
    paidMinor,
    categoryId: input.categoryId ?? null,
    vendorId: input.vendorId ?? null,
    dueDate: calendarDate(input.dueDate),
    note: optional(input.note, 2_000),
  };
}

function instant(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new DomainValidationError("Invalid UTC instant");
  const normalized = new Date(value).toISOString();
  // Date.parse normalizes impossible calendar dates such as February 30.
  const exact = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`,
  );
  if (normalized !== exact)
    throw new DomainValidationError("Invalid UTC instant");
  return normalized;
}

export function normalizeRunSheetItem(
  input: RunSheetItemInput,
): Required<RunSheetItemInput> {
  const startsAt = instant(input.startsAt);
  const endsAt = instant(input.endsAt);
  if (endsAt <= startsAt)
    throw new DomainValidationError("End time must follow start time");
  return {
    title: required(input.title, "Schedule title", 180),
    startsAt,
    endsAt,
    location: optional(input.location, 180),
    responsible: optional(input.responsible, 120),
    note: optional(input.note, 2_000),
  };
}

export function normalizeSeatingTable(
  input: SeatingTableInput,
): SeatingTableInput {
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < 1 ||
    input.capacity > 100
  )
    throw new DomainValidationError("Table capacity must be 1–100");
  return {
    name: required(input.name, "Table name", 80),
    capacity: input.capacity,
  };
}

/** Resolves an unambiguous local wall-clock time without assuming the user's device zone. */
export function resolveWeddingLocalTime(
  value: string,
  timeZone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new DomainValidationError("Invalid local date and time");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new DomainValidationError("Invalid wedding time zone");
  }
  const base = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(base))
    throw new DomainValidationError("Invalid local date and time");
  const matching: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(base - offset * 60_000);
    const parts = Object.fromEntries(
      formatter
        .formatToParts(candidate)
        .map(({ type, value: text }) => [type, text]),
    );
    if (
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` ===
      value
    )
      matching.push(candidate.toISOString());
  }
  if (matching.length !== 1)
    throw new DomainValidationError(
      "Local wedding time is missing or ambiguous in its time zone",
    );
  return matching[0]!;
}
