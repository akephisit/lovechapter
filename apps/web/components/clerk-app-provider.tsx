"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { parseClerkPublishableKey } from "../lib/clerk-config";

const publishableKey = parseClerkPublishableKey(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

export function ClerkAppProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      {children}
    </ClerkProvider>
  );
}
