const message = "Service temporarily unavailable";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LoveChapter is temporarily unavailable</title>
<style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fbf6ef; color: #352229; }
  main { max-width: 36rem; padding: 2rem; text-align: center; }
  h1 { color: #71384b; font-size: clamp(2rem, 7vw, 3rem); }
  p { line-height: 1.6; }
</style>
</head>
<body><main><h1>LoveChapter</h1><p>${message}. Please try again shortly.</p></main></body>
</html>`;

export function maintenanceResponse(
  pathname: string,
  method: string,
): Response {
  const headers = {
    "cache-control": "no-store",
    "retry-after": "60",
  };
  const api = pathname === "/api" || pathname.startsWith("/api/");
  if (method === "HEAD") {
    return new Response(null, {
      status: 503,
      headers: {
        ...headers,
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
  return new Response(html, {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}
