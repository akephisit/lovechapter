export type UiLanguage = "en" | "th";

export const UI_LANGUAGE_COOKIE = "lc_ui_language";

export function resolveUiLanguage(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): UiLanguage {
  if (cookieValue === "en" || cookieValue === "th") return cookieValue;
  if (!acceptLanguage) return "en";

  const scores: Record<UiLanguage, number> = { en: -1, th: -1 };
  for (const preference of acceptLanguage.split(",")) {
    const [rawTag, ...parameters] = preference.trim().split(";");
    const tag = rawTag?.trim().toLowerCase() ?? "";
    const language = tag.split("-")[0];
    if (
      (language !== "en" && language !== "th") ||
      !/^[a-z]{2}(?:-[a-z0-9]{1,8})*$/u.test(tag)
    ) {
      continue;
    }

    let quality = 1;
    if (parameters.length > 0) {
      if (parameters.length !== 1) continue;
      const match = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.exec(
        parameters[0]?.trim() ?? "",
      );
      if (!match) continue;
      quality = Number(match[1]);
    }
    if (quality > 0) scores[language] = Math.max(scores[language], quality);
  }

  return scores.th > scores.en ? "th" : "en";
}
