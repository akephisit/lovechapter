import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { AuthErrorBoundary } from "../components/auth-error-boundary";
import { AuthSessionProvider } from "../components/auth-session-provider";
import { PwaRegister } from "../components/pwa-register";
import { ReleaseRefresh } from "../components/release-refresh";
import { UiLanguageProvider } from "../components/ui-language-provider";
import { getUiCopy } from "../lib/ui-copy";
import { resolveUiLanguage, UI_LANGUAGE_COOKIE } from "../lib/ui-language";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const language = resolveUiLanguage(
    cookieStore.get(UI_LANGUAGE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  );
  const copy = getUiCopy(language);
  return {
    title: { default: copy.metadata.title, template: "%s · LoveChapter" },
    description: copy.metadata.description,
    applicationName: "LoveChapter",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg" },
    referrer: "no-referrer",
  };
}

export const viewport: Viewport = {
  themeColor: "#71384b",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const initialSha = requestHeaders.get("x-lovechapter-published-sha");
  const language = resolveUiLanguage(
    cookieStore.get(UI_LANGUAGE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  );
  return (
    <html lang={language}>
      <body>
        <UiLanguageProvider language={language}>
          <AuthErrorBoundary>
            <AuthSessionProvider>{children}</AuthSessionProvider>
          </AuthErrorBoundary>
        </UiLanguageProvider>
        <PwaRegister />
        <ReleaseRefresh initialSha={initialSha} />
      </body>
    </html>
  );
}
