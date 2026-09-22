export type NormalizedEmail = {
  email: string;
  emailKey: string;
};

export function normalizeEmail(value: string): NormalizedEmail {
  const email = value.trim().normalize("NFC");
  if ([...email].length > 320) {
    throw new Error("Email must not exceed 320 Unicode code points");
  }
  const parts = email.split("@");
  const local = parts[0];
  const domain = parts[1];
  if (
    parts.length !== 2 ||
    !local ||
    !domain ||
    /\s/u.test(email) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !validDomain(domain)
  ) {
    throw new Error("Email must be a valid email address");
  }
  return { email, emailKey: email.toLowerCase() };
}

function validDomain(domain: string): boolean {
  if (domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => {
    if (!label || label.length > 63) return false;
    return (
      /^[\p{L}\p{N}-]+$/u.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
    );
  });
}
