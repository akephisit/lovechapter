import {
  COUNTRY_CODES,
  COUNTRY_NAMES,
  LOCALE_CANDIDATES,
  isCountryCode,
} from "@lovechapter/contracts";
import type { UiLanguage } from "./ui-language";

export type StandardCodeKind = "locale" | "timeZone" | "currency" | "country";
export type StandardOption = { value: string; label: string };

const cache = new Map<string, StandardOption[]>();
const fallbackZones = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Bangkok",
  "Asia/Tokyo",
];
const fallbackCurrencies = ["USD", "EUR", "GBP", "THB", "JPY", "AUD", "CAD"];

export function getStandardOptions(
  kind: StandardCodeKind,
  uiLanguage: UiLanguage,
  selected?: string,
  date?: string,
): StandardOption[] {
  const key = `${kind}:${uiLanguage}:${kind === "timeZone" ? (date ?? "") : ""}`;
  let options = cache.get(key);
  if (!options) {
    const display = (
      type: "region" | "currency" | "language",
      value: string,
    ) => {
      try {
        return new Intl.DisplayNames(uiLanguage, { type }).of(value) ?? value;
      } catch {
        return value;
      }
    };
    const values =
      kind === "country"
        ? COUNTRY_CODES
        : kind === "locale"
          ? ["en", "th", ...LOCALE_CANDIDATES]
          : kind === "currency"
            ? supported("currency", fallbackCurrencies)
            : ["UTC", ...supported("timeZone", fallbackZones)];
    options = [...new Set(values)].map((value) => ({
      value,
      label: label(kind, value, display, uiLanguage, date),
    }));
    options.sort((a, b) =>
      new Intl.Collator(uiLanguage).compare(a.label, b.label),
    );
    if (cache.size >= 32) cache.clear();
    cache.set(key, options);
  }
  if (
    !selected ||
    options.some((option) => option.value === selected) ||
    !valid(kind, selected)
  )
    return options;
  const display = (type: "region" | "currency" | "language", value: string) => {
    try {
      return new Intl.DisplayNames(uiLanguage, { type }).of(value) ?? value;
    } catch {
      return value;
    }
  };
  return [
    {
      value: selected,
      label: label(kind, selected, display, uiLanguage, date),
    },
    ...options,
  ];
}

function supported(
  kind: "currency" | "timeZone",
  fallback: string[],
): string[] {
  try {
    return Intl.supportedValuesOf(kind);
  } catch {
    return fallback;
  }
}

function valid(kind: StandardCodeKind, value: string): boolean {
  try {
    if (kind === "country") return isCountryCode(value);
    if (kind === "locale") {
      new Intl.Locale(value);
      return true;
    }
    if (kind === "timeZone") {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    }
    new Intl.NumberFormat("en", { style: "currency", currency: value });
    return (
      /^[A-Z]{3}$/.test(value) &&
      supported("currency", fallbackCurrencies).includes(value)
    );
  } catch {
    return false;
  }
}

function label(
  kind: StandardCodeKind,
  value: string,
  display: (type: "region" | "currency" | "language", value: string) => string,
  uiLanguage: UiLanguage,
  date?: string,
): string {
  if (kind === "country") {
    const localized = display("region", value);
    return `${localized === value ? (COUNTRY_NAMES[value] ?? value) : localized} (${value})`;
  }
  if (kind === "currency") return `${display("currency", value)} (${value})`;
  if (kind === "locale") {
    const locale = new Intl.Locale(value);
    return `${display("language", locale.language)}${locale.region ? ` — ${display("region", locale.region)}` : ""} (${value})`;
  }
  let instant = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const dated = new Date(`${date}T12:00:00Z`);
    if (!Number.isNaN(dated.valueOf())) instant = dated;
  }
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat(uiLanguage, {
        timeZone: value,
        timeZoneName: "shortOffset",
      })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    /* A stored valid zone may be unsupported in this browser. */
  }
  return offset ? `${value} (${offset})` : value;
}
