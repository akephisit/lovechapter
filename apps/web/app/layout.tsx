import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PwaRegister } from "../components/pwa-register";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
