export function parseClerkPublishableKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || !/^pk_(test|live)_/.test(key)) {
    throw new Error(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key",
    );
  }
  return key;
}
