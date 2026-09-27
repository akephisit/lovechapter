import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AuthErrorBoundary } from "../components/auth-error-boundary";
import { AuthSessionProvider } from "../components/auth-session-provider";
import { PwaRegister } from "../components/pwa-register";
import { ReleaseRefresh } from "../components/release-refresh";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "LoveChapter — Wedding planning & RSVP",
    template: "%s · LoveChapter",
  },
  description:
    "A calm wedding workspace for couples and a private, account-free RSVP for guests.",
  applicationName: "LoveChapter",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#71384b",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialSha = (await headers()).get("x-lovechapter-published-sha");
  return (
    <html lang="en">
      <body>
        <AuthErrorBoundary>
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </AuthErrorBoundary>
        <PwaRegister />
        <ReleaseRefresh initialSha={initialSha} />
      </body>
    </html>
  );
}
