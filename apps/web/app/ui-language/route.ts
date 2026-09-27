import { UI_LANGUAGE_COOKIE, type UiLanguage } from "../../lib/ui-language";

const lifetimeSeconds = 60 * 60 * 24 * 365;

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (request.headers.get("origin") !== url.origin) {
    return new Response(null, { status: 403, headers });
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim();
  let value: unknown;
  try {
    if (contentType === "application/json") {
      const payload: unknown = await request.json();
      value =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).language
          : undefined;
    } else if (contentType === "application/x-www-form-urlencoded") {
      value = (await request.formData()).get("language");
    } else {
      return new Response(null, { status: 415, headers });
    }
  } catch {
    return new Response(null, { status: 400, headers });
  }

  if (value !== "en" && value !== "th") {
    return new Response(null, { status: 400, headers });
  }
  const language: UiLanguage = value;
  const secure =
    process.env.NODE_ENV === "production" || url.protocol === "https:";
  headers.set(
    "set-cookie",
    `${UI_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${lifetimeSeconds}; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`,
  );
  if (contentType === "application/x-www-form-urlencoded") {
    headers.set("location", new URL("/", url).toString());
    return new Response(null, { status: 303, headers });
  }
  return new Response(null, { status: 204, headers });
}
