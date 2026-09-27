import { cookies, headers } from "next/headers";

import { getUiCopy } from "./ui-copy";
import { resolveUiLanguage, UI_LANGUAGE_COOKIE } from "./ui-language";

export async function getServerUiCopy() {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  return getUiCopy(
    resolveUiLanguage(
      cookieStore.get(UI_LANGUAGE_COOKIE)?.value,
      requestHeaders.get("accept-language"),
    ),
  );
}
