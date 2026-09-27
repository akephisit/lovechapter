import { getUiCopy } from "./ui-copy";
import type { UiLanguage } from "./ui-language";

const message = "Service temporarily unavailable";

function maintenanceHtml(language: UiLanguage): string {
  const copy = getUiCopy(language);
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="origin">
<title>${copy.maintenance.title}</title>
<style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fbf6ef; color: #352229; }
  main { max-width: 36rem; padding: 2rem; text-align: center; }
  h1 { color: #71384b; font-size: clamp(2rem, 7vw, 3rem); }
  p { line-height: 1.6; }
  form { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .75rem; margin-top: 2rem; }
  select, button { min-height: 2.75rem; border-radius: .75rem; padding: .5rem .75rem; font: inherit; }
  select { border: 1px solid #ad8793; background: white; }
  button { border: 0; background: #71384b; color: white; cursor: pointer; }
</style>
</head>
<body><main><h1>LoveChapter</h1><p>${copy.maintenance.message}</p><p>${copy.maintenance.notice}</p><form action="/ui-language" method="post"><label for="ui-language">${copy.common.language}</label><select id="ui-language" name="language"><option value="en"${language === "en" ? " selected" : ""}>English</option><option value="th"${language === "th" ? " selected" : ""}>ไทย</option></select><button type="submit">${copy.maintenance.applyLanguage}</button></form></main></body>
</html>`;
}

export function maintenanceResponse(
  pathname: string,
  method: string,
  language: UiLanguage = "en",
): Response {
  const headers = {
    "cache-control": "no-store",
    "retry-after": "60",
    "referrer-policy": "no-referrer",
  };
  const api = pathname === "/api" || pathname.startsWith("/api/");
  if (method === "HEAD") {
    return new Response(null, {
      status: 503,
      headers: {
        ...headers,
        ...(!api && { "referrer-policy": "origin" }),
        "content-type": api
          ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8",
      },
    });
  }
  if (api) {
    return Response.json(
      { error: { code: "maintenance", message } },
      { status: 503, headers },
    );
  }
  return new Response(maintenanceHtml(language), {
    status: 503,
    headers: {
      ...headers,
      "referrer-policy": "origin",
      "content-type": "text/html; charset=utf-8",
    },
  });
}
