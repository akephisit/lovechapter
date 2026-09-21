export function parsePublicApiOrigin(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      "NEXT_PUBLIC_API_ORIGIN is required at web build time (for example, https://lovechapter-api.<account>.workers.dev)",
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_API_ORIGIN must be a valid HTTP(S) origin");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_API_ORIGIN must be a valid HTTP(S) origin");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_ORIGIN must be an exact origin without a path",
    );
  }
  return url.origin;
}
